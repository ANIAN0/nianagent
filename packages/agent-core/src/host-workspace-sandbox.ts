import {
  createWriteStream,
  existsSync,
} from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, type Readable as NodeReadable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  SandboxBackend,
  SandboxBackendCreateInput,
  SandboxBackendHandle,
  SandboxBackendPrewarmInput,
  SandboxSession,
} from "eve/sandbox";
import type { AgentId } from "./model-catalog";
import type { WorkspaceRoot } from "./workspace-binding";
import {
  getBindingByWorkspaceId,
  WorkspaceStoreError,
} from "./workspace-store";
import {
  normalizeLogicalWorkspacePath,
  resolveWorkspacePath,
  WorkspacePathError,
  WORKSPACE_LOGICAL_PREFIX,
} from "./workspace-paths";

export const HOST_WORKSPACE_BACKEND_NAME = "nianagent-host-workspace";

export type HostWorkspaceSessionOptions = {
  readonly workspaceId: string;
};

type BoundState = {
  readonly workspaceId: string;
  readonly roots: readonly WorkspaceRoot[];
};

type SessionBucket = {
  readonly sessionKey: string;
  readonly agentId: AgentId;
  bound: BoundState | null;
};

type PrewarmResult = { readonly reused: boolean };

/**
 * 未绑定或绑定失败时，一切宿主 I/O / 命令 API 拒绝。
 */
function unboundError(): Error {
  return new Error(
    "host-workspace 未绑定 workspaceId：拒绝宿主文件与命令操作。请确认会话 capability 有效且 onSession 已绑定。",
  );
}

async function loadBound(
  agentId: AgentId,
  workspaceId: string,
): Promise<BoundState> {
  let record;
  try {
    record = await getBindingByWorkspaceId(workspaceId);
  } catch (err) {
    if (err instanceof WorkspaceStoreError) {
      throw new Error(`加载 workspace binding 失败：${err.message}`);
    }
    throw err;
  }
  if (!record) {
    throw new Error(`workspaceId 不存在：${workspaceId}`);
  }
  if (record.revokedAt) {
    throw new Error(`workspace binding 已撤销：${workspaceId}`);
  }
  if (record.agentId !== agentId) {
    throw new Error(
      `workspace binding 的 agent 不匹配（期望 ${agentId}，实际 ${record.agentId}）。`,
    );
  }
  return { workspaceId: record.workspaceId, roots: record.roots };
}

function bufferToWebStream(buf: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(buf)) as ReadableStream<Uint8Array>;
}

async function readWebStreamToBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

function createHostSandboxSession(bucket: SessionBucket): SandboxSession {
  const requireBound = (): BoundState => {
    if (!bucket.bound) throw unboundError();
    return bucket.bound;
  };

  const resolveHost = async (userPath: string) => {
    const bound = requireBound();
    return resolveWorkspacePath(userPath, bound.roots);
  };

  const session: SandboxSession = {
    id: bucket.sessionKey,
    resolvePath(p: string): string {
      if (!bucket.bound) {
        try {
          return normalizeLogicalWorkspacePath(p);
        } catch {
          if (!p.startsWith("/")) return `${WORKSPACE_LOGICAL_PREFIX}${p}`;
          return p;
        }
      }
      try {
        return normalizeLogicalWorkspacePath(p);
      } catch (err) {
        if (err instanceof WorkspacePathError) throw err;
        throw err;
      }
    },
    async readFile(options) {
      const resolved = await resolveHost(options.path);
      if (!existsSync(resolved.hostPath)) return null;
      const st = await stat(resolved.hostPath);
      if (!st.isFile()) return null;
      const buf = await readFile(resolved.hostPath);
      return bufferToWebStream(buf);
    },
    async readBinaryFile(options) {
      const resolved = await resolveHost(options.path);
      try {
        return await readFile(resolved.hostPath);
      } catch {
        return null;
      }
    },
    async readTextFile(options) {
      const resolved = await resolveHost(options.path);
      try {
        let text = await readFile(resolved.hostPath, {
          encoding: (options.encoding as BufferEncoding | undefined) ?? "utf8",
        });
        if (options.startLine !== undefined || options.endLine !== undefined) {
          const lines = text.split(/\r?\n/);
          const start = Math.max(1, options.startLine ?? 1) - 1;
          const end = Math.min(lines.length, options.endLine ?? lines.length);
          text = lines.slice(start, end).join("\n");
        }
        return text;
      } catch {
        return null;
      }
    },
    async writeFile(options) {
      const resolved = await resolveHost(options.path);
      await mkdir(path.win32.dirname(resolved.hostPath), { recursive: true });
      const content = options.content as unknown;
      if (content && typeof content === "object" && "getReader" in (content as object)) {
        const buf = await readWebStreamToBuffer(
          content as ReadableStream<Uint8Array>,
        );
        await writeFile(resolved.hostPath, buf);
        return;
      }
      if (content instanceof Uint8Array) {
        await writeFile(resolved.hostPath, content);
        return;
      }
      // Node Readable 兜底
      if (content && typeof (content as NodeReadable).pipe === "function") {
        await pipeline(content as NodeReadable, createWriteStream(resolved.hostPath));
        return;
      }
      throw new Error("writeFile: 不支持的 content 类型");
    },
    async writeBinaryFile(options) {
      const resolved = await resolveHost(options.path);
      await mkdir(path.win32.dirname(resolved.hostPath), { recursive: true });
      await writeFile(resolved.hostPath, options.content);
    },
    async writeTextFile(options) {
      const resolved = await resolveHost(options.path);
      await mkdir(path.win32.dirname(resolved.hostPath), { recursive: true });
      await writeFile(resolved.hostPath, options.content, {
        encoding: (options.encoding as BufferEncoding | undefined) ?? "utf8",
      });
    },
    async removePath(options) {
      const resolved = await resolveHost(options.path);
      try {
        await rm(resolved.hostPath, {
          force: options.force ?? false,
          recursive: options.recursive ?? false,
        });
      } catch (err) {
        if (options.force) return;
        throw err;
      }
    },
    async run() {
      throw new Error(
        "host-workspace 禁用 sandbox.run（默认 bash 不可用）。请使用 powershell 工具。",
      );
    },
    async spawn() {
      throw new Error(
        "host-workspace 禁用 sandbox.spawn。请使用 powershell 工具。",
      );
    },
    async setNetworkPolicy() {
      // 宿主进程无沙箱防火墙；显式 no-op
    },
  };

  return session;
}

/**
 * 自定义 SandboxBackend：映射 /workspace/<alias> → 经校验的宿主 roots。
 * 生命周期 A–D：未绑定拒绝；onSession 首次绑定；captureState 仅 workspaceId；重连靠 metadata。
 */
export function createHostWorkspaceBackend(
  agentId: AgentId,
): SandboxBackend<Record<string, never>, HostWorkspaceSessionOptions> {
  // 按 sessionKey 分桶；禁止进程级「唯一 binding」全局变量
  const buckets = new Map<string, SessionBucket>();

  return {
    name: HOST_WORKSPACE_BACKEND_NAME,

    async prewarm(
      _input: SandboxBackendPrewarmInput<Record<string, never>>,
    ): Promise<PrewarmResult> {
      return { reused: true };
    },

    async create(
      input: SandboxBackendCreateInput,
    ): Promise<SandboxBackendHandle<HostWorkspaceSessionOptions>> {
      const sessionKey = input.sessionKey;
      let bucket = buckets.get(sessionKey);
      if (!bucket) {
        bucket = { sessionKey, agentId, bound: null };
        buckets.set(sessionKey, bucket);
      }

      const metaId =
        typeof input.existingMetadata?.workspaceId === "string"
          ? input.existingMetadata.workspaceId
          : undefined;

      // D：重连 — 仅用 workspaceId 从 Turso 重建，不依赖 onSession
      if (metaId) {
        try {
          bucket.bound = await loadBound(agentId, metaId);
        } catch {
          bucket.bound = null;
        }
      } else {
        // A：首次 create 无 metadata → 未绑定 handle
        bucket.bound = null;
      }

      const session = createHostSandboxSession(bucket);

      const useSessionFn = async (
        options?: HostWorkspaceSessionOptions,
      ): Promise<SandboxSession> => {
        // B：onSession 调用 use({ workspaceId })
        if (options?.workspaceId) {
          try {
            bucket!.bound = await loadBound(agentId, options.workspaceId);
          } catch (err) {
            bucket!.bound = null;
            throw err;
          }
        }
        return createHostSandboxSession(bucket!);
      };

      return {
        session,
        useSessionFn,
        async captureState() {
          // C：仅非敏感 workspaceId；禁止 capability / canonicalPath / roots
          const metadata: Record<string, unknown> = {};
          if (bucket!.bound?.workspaceId) {
            metadata.workspaceId = bucket!.bound.workspaceId;
          }
          return {
            backendName: HOST_WORKSPACE_BACKEND_NAME,
            sessionKey,
            metadata,
          };
        },
        async shutdown() {
          buckets.delete(sessionKey);
        },
      };
    },
  };
}

export async function listDirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
