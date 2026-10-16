import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ReadOnlyPatch } from "@/components/read-only-patch"
import { useFileWorkbenchService } from "./file-service"
export type GitEntry = {
  name: string
  path: string
  stage: "staged" | "unstaged" | "untracked"
  status: string
}
export type GitStatus = {
  available: boolean
  root?: string
  error?: string
  entries?: GitEntry[]
}
export type GitReadService = {
  status: (sessionId: string, signal: AbortSignal) => Promise<GitStatus>
  diff: (
    sessionId: string,
    entry: GitEntry,
    signal: AbortSignal
  ) => Promise<string>
}
function observeVisible(read: (signal: AbortSignal) => Promise<void>) {
  let active = true
  let request: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const update = async () => {
    if (!active || document.hidden || request) return
    clearTimeout(timer)
    const current = new AbortController()
    request = current
    try {
      await read(current.signal)
    } finally {
      if (request === current) request = undefined
      if (active && !document.hidden)
        timer = setTimeout(() => {
          void update()
        }, 2000)
    }
  }
  const visibility = () => {
    if (document.hidden) {
      request?.abort()
      clearTimeout(timer)
    } else void update()
  }
  void update()
  document.addEventListener("visibilitychange", visibility)
  window.addEventListener("focus", visibility)
  return () => {
    active = false
    request?.abort()
    clearTimeout(timer)
    document.removeEventListener("visibilitychange", visibility)
    window.removeEventListener("focus", visibility)
  }
}
export function GitViewer({
  sessionId,
  onOpen,
  service: providedService,
}: {
  sessionId: string
  onOpen: (path: string) => Promise<void>
  service?: GitReadService
}) {
  const files = useFileWorkbenchService()
  const service = useMemo<GitReadService>(
    () =>
      providedService || {
        status: (sessionId, signal) => files.call("git", {}, sessionId, signal),
        diff: async (sessionId, entry, signal) =>
          (
            await files.call<{ patch: string }>(
              "gitDiff",
              { path: entry.path, stage: entry.stage },
              sessionId,
              signal
            )
          ).patch,
      },
    [providedService, files]
  )
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState<GitStatus>()
  const [selected, setSelected] = useState<GitEntry>()
  const [patch, setPatch] = useState<string>()
  const [statusError, setStatusError] = useState("")
  const [patchError, setPatchError] = useState("")
  const [actionError, setActionError] = useState("")
  const error = [statusError, patchError, actionError].filter(Boolean).join(" ")
  useEffect(() => {
    return observeVisible(async (signal) => {
      try {
        const value = await service.status(sessionId, signal)
        if (signal.aborted) return
        setStatus((previous) =>
          JSON.stringify(previous) === JSON.stringify(value) ? previous : value
        )
        setSelected((previous) =>
          previous &&
          value.entries?.some(
            (entry) =>
              entry.path === previous.path && entry.stage === previous.stage
          )
            ? previous
            : undefined
        )
        setStatusError("")
      } catch (failure) {
        if (!signal.aborted)
          setStatusError(
            failure instanceof Error ? failure.message : "仓库状态未能读取。"
          )
      }
    })
  }, [sessionId, revision, service])
  useEffect(() => {
    if (!selected) return
    return observeVisible(async (signal) => {
      try {
        const value = await service.diff(sessionId, selected, signal)
        if (signal.aborted) return
        setPatch(value)
        setPatchError("")
      } catch (failure) {
        if (!signal.aborted)
          setPatchError(
            failure instanceof Error ? failure.message : "所选差异未能读取。"
          )
      }
    })
  }, [selected, sessionId, revision, service])
  return (
    <section className="file-git">
      <div className="file-body-toolbar">
        <strong>Git当前状态 · 整个仓库</strong>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setStatusError("")
            setPatchError("")
            setActionError("")
            setStatus(undefined)
            setSelected(undefined)
            setPatch(undefined)
            setRevision((value) => value + 1)
          }}
        >
          刷新现状
        </Button>
      </div>
      <p className="file-page-caption">
        {status?.root ||
          status?.error ||
          (error ? "仓库读取失败" : "正在读取仓库…")}{" "}
        · 外部修改也会列入，不代表本会话的操作记录。
      </p>
      {error && (
        <p className="file-message" role="alert">
          {error}
        </p>
      )}
      {status?.available && !status.entries?.length && (
        <p className="file-message">仓库当前没有已暂存、未暂存或未跟踪变更。</p>
      )}
      <div className="file-change-list">
        {(["staged", "unstaged", "untracked"] as const).map((stage) => {
          const entries =
            status?.entries?.filter((entry) => entry.stage === stage) || []
          return (
            !!entries.length && (
              <div key={stage}>
                <h3 className="file-page-caption">
                  {
                    {
                      staged: "已暂存",
                      unstaged: "未暂存",
                      untracked: "未跟踪",
                    }[stage]
                  }
                </h3>
                {entries.map((entry) => (
                  <Button
                    key={entry.path}
                    variant="ghost"
                    size="sm"
                    className="file-tree-entry"
                    title={entry.path}
                    onClick={() => {
                      if (selected === entry && !error) return
                      setPatchError("")
                      setActionError("")
                      setPatch(undefined)
                      setSelected({ ...entry })
                    }}
                  >
                    {entry.status} · {entry.name}
                  </Button>
                ))}
              </div>
            )
          )
        })}
      </div>
      {selected && (
        <>
          <div className="file-body-toolbar">
            <span role="tab" aria-selected="true">
              差异 · {selected.name}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void onOpen(selected.path).catch((error) =>
                  setActionError(error.message)
                )
              }
            >
              打开当前文件
            </Button>
          </div>
          <div className="file-git-patch">
            {error ? (
              <p>当前差异读取失败，请重新选择或刷新现状。</p>
            ) : patch === undefined ? (
              <p role="status">正在读取当前差异…</p>
            ) : patch ? (
              <ReadOnlyPatch patch={patch} />
            ) : (
              <p>该项当前没有可显示的文字差异。</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
