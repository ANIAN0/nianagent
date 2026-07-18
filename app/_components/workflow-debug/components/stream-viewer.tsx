"use client";

/**
 * Stream 查看器（P3/P7）：分块展示、运行中轮询续读、自动滚动。
 * 二进制帧尽力解码为 UTF-8/JSON；无法 hydrate 的保留 hex 预览。
 */

import { Loader2Icon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkflowDebugAgent } from "../agent-context";
import { streamUrl } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;
const FRAME_HEADER = 4;

type ChunkView = {
  id: number;
  text: string;
  binary: boolean;
};

function decodeBytes(buf: Uint8Array): ChunkView[] {
  if (buf.length === 0) return [];

  // 尝试 framed：4 字节大端长度 + payload
  const frames = tryParseFrames(buf);
  if (frames) {
    return frames.map((payload, i) => frameToChunk(payload, i));
  }

  // 整包 UTF-8
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return [{ id: 0, text, binary: false }];
  } catch {
    return [
      {
        id: 0,
        text: toHexPreview(buf, 2048),
        binary: true,
      },
    ];
  }
}

function tryParseFrames(buf: Uint8Array): Uint8Array[] | null {
  if (buf.length < FRAME_HEADER) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const first = view.getUint32(0, false);
  if (first <= 0 || first > 10 * 1024 * 1024) return null;

  const out: Uint8Array[] = [];
  let offset = 0;
  while (offset + FRAME_HEADER <= buf.length) {
    const len = view.getUint32(offset, false);
    if (len <= 0 || len > 10 * 1024 * 1024) {
      return out.length > 0 ? out : null;
    }
    offset += FRAME_HEADER;
    if (offset + len > buf.length) {
      // 不完整尾帧：有已解析帧则返回
      return out.length > 0 ? out : null;
    }
    out.push(buf.slice(offset, offset + len));
    offset += len;
  }
  return out.length > 0 ? out : null;
}

function frameToChunk(payload: Uint8Array, id: number): ChunkView {
  // 跳过可能的 format 前缀 "devl"/"encr"（4 字节 ascii）
  let data = payload;
  if (payload.length >= 4) {
    const tag = String.fromCharCode(
      payload[0]!,
      payload[1]!,
      payload[2]!,
      payload[3]!,
    );
    if (tag === "devl" || tag === "encr") {
      data = payload.slice(4);
    }
  }
  if (tagIsEncrypted(payload)) {
    return { id, text: t("streamEncrypted"), binary: true };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    // 尝试 pretty JSON
    try {
      const parsed = JSON.parse(text) as unknown;
      return {
        id,
        text: JSON.stringify(parsed, null, 2),
        binary: false,
      };
    } catch {
      return { id, text, binary: false };
    }
  } catch {
    return { id, text: toHexPreview(data, 512), binary: true };
  }
}

function tagIsEncrypted(payload: Uint8Array): boolean {
  if (payload.length < 4) return false;
  return (
    payload[0] === 0x65 &&
    payload[1] === 0x6e &&
    payload[2] === 0x63 &&
    payload[3] === 0x72
  );
}

function toHexPreview(buf: Uint8Array, max: number): string {
  const slice = buf.slice(0, max);
  const hex = Array.from(slice)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  return buf.length > max ? `${hex} … (+${buf.length - max} bytes)` : hex;
}

export function StreamViewer({
  runId,
  streamId,
  live = true,
  runStatus,
  className,
}: {
  readonly runId: string;
  readonly streamId: string;
  readonly live?: boolean;
  readonly runStatus?: string;
  readonly className?: string;
}) {
  const { agentId } = useWorkflowDebugAgent();
  const [chunks, setChunks] = useState<ChunkView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [byteLength, setByteLength] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const active =
    live &&
    !paused &&
    (runStatus === "running" || runStatus === "pending" || !runStatus);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await fetch(streamUrl(agentId, streamId, runId, 0));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (cancelled) return;
        setByteLength(buf.length);
        setChunks(decodeBytes(buf));
        setError(null);
        setIsLive(Boolean(active));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLive(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (!cancelled && active) {
        timer = setTimeout(() => {
          void load();
        }, POLL_MS);
      } else if (!cancelled) {
        setIsLive(false);
      }
    };

    setLoading(true);
    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentId, runId, streamId, active]);

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chunks]);

  return (
    <div
      className={cn(
        "flex min-h-[16rem] flex-col rounded-lg border bg-card",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h4 className="font-medium text-sm">
            {t("streamViewer")}
            <span className="ml-2 font-mono text-muted-foreground text-xs">
              {streamId}
            </span>
          </h4>
          <p className="text-[11px] text-muted-foreground">
            {t("streamBytes").replace("{n}", String(byteLength))}
            {" · "}
            {t("streamChunks").replace("{n}", String(chunks.length))}
            {isLive ? (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                ● {t("streamLive")}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {live ? (
            <Button
              className="h-8 gap-1 text-xs"
              onClick={() => setPaused((p) => !p)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {paused ? (
                <>
                  <PlayIcon className="size-3.5" />
                  {t("streamResume")}
                </>
              ) : (
                <>
                  <PauseIcon className="size-3.5" />
                  {t("streamPause")}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto p-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          autoScroll.current = nearBottom;
        }}
      >
        {loading && chunks.length === 0 ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("loading")}
          </p>
        ) : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && chunks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("streamEmpty")}</p>
        ) : null}
        <ol className="space-y-2">
          {chunks.map((c) => (
            <li
              className={cn(
                "rounded border px-2 py-1.5 font-mono text-[11px]",
                c.binary && "bg-muted/40 text-muted-foreground",
              )}
              key={c.id}
            >
              <div className="mb-0.5 text-[10px] text-muted-foreground">
                #{c.id}
                {c.binary ? ` · ${t("streamBinary")}` : ""}
              </div>
              <pre className="whitespace-pre-wrap break-all">{c.text || " "}</pre>
            </li>
          ))}
        </ol>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
