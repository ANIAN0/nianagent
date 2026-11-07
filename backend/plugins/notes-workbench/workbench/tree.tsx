import { useState } from "react"
import { api, message } from "./api"
import type { Snapshot } from "./types"

/** 侧栏目录树：搜索过滤由调用方完成（同一份结果供键盘导航复用）；折叠时只留窄条。 */
export function Tree({
  snapshot,
  selectedId,
  query,
  onQuery,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onChange,
  onError,
}: {
  snapshot: Snapshot | null
  selectedId: string | null
  query: string
  onQuery: (value: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (pageId: string) => void
  onChange: () => void
  onError: (text: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const createDirectory = async () => {
    if (!name.trim()) return
    try {
      await api.createDirectory(name.trim())
      setName("")
      setCreating(false)
      onChange()
    } catch (error) {
      onError(message(error))
    }
  }
  const createPage = async (directoryId: string) => {
    const existing =
      snapshot?.pages.filter((page) => page.directoryId === directoryId) ?? []
    const base = `页面-${existing.length + 1}`
    let label = base
    for (let attempt = 2; attempt < 99; attempt += 1) {
      if (!existing.some((page) => page.name === label)) break
      label = `${base}-${attempt}`
    }
    try {
      const value = await api.createPage(directoryId, label)
      onChange()
      onSelect(value.page.id)
    } catch (error) {
      onError(message(error))
    }
  }
  const removePage = async (pageId: string) => {
    if (!window.confirm("删除该页面及其评论？")) return
    try {
      await api.deletePage(pageId)
      onChange()
      if (selectedId === pageId) onSelect("")
    } catch (error) {
      onError(message(error))
    }
  }
  const removeDirectory = async (directoryId: string) => {
    if (!window.confirm("删除该目录及其中全部页面？")) return
    try {
      await api.deleteDirectory(directoryId)
      onChange()
      const doomed = snapshot?.pages
        .filter((page) => page.directoryId === directoryId)
        .map((page) => page.id)
      if (selectedId && doomed?.includes(selectedId)) onSelect("")
    } catch (error) {
      onError(message(error))
    }
  }
  if (collapsed)
    return (
      <aside className="flex h-full w-9 shrink-0 flex-col items-center gap-2 border-r border-[var(--border)] bg-[var(--panel)] py-2">
        <button
          type="button"
          aria-label="展开目录"
          title="展开目录（Ctrl+B）"
          className="rounded p-1 text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--raised)] hover:text-[var(--text)]"
          onClick={onToggleCollapsed}
        >
          »
        </button>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-hidden pt-1">
          {snapshot?.directories.map((directory) => (
            <span
              key={directory.id}
              className="text-[10px] text-[var(--text-faint)]"
            >
              {directory.name.slice(0, 1)}
            </span>
          ))}
        </div>
      </aside>
    )
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-1 px-3 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)]">
          目录
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="折叠目录"
            title="折叠目录（Ctrl+B）"
            className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-2)]"
            onClick={onToggleCollapsed}
          >
            «
          </button>
          <button
            type="button"
            className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-2)]"
            onClick={() => setCreating((value) => !value)}
          >
            + 目录
          </button>
        </div>
      </div>
      <div className="px-3 pb-2">
        <input
          id="page-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation()
              onQuery("")
              event.currentTarget.blur()
            }
          }}
          placeholder="搜索页面…（/）"
          aria-label="搜索页面"
          className="w-full rounded bg-[var(--raised)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent)]"
        />
      </div>
      {creating && (
        <div className="flex gap-1.5 px-3 pb-2">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createDirectory()
            }}
            placeholder="目录名"
            aria-label="目录名"
            className="min-w-0 flex-1 rounded bg-[var(--raised)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent)]"
          />
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-2 text-xs font-medium text-white"
            onClick={() => void createDirectory()}
          >
            添加
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshot?.directories.length ? (
          snapshot.directories.map((directory) => {
            const pages = snapshot.pages.filter(
              (page) => page.directoryId === directory.id
            )
            return (
              <div key={directory.id} className="pt-2 pb-1">
                <div className="group flex items-center px-3 py-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-2)]">
                    {directory.name}
                  </span>
                  <button
                    type="button"
                    className="ml-1 px-1 text-[11px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--accent)]"
                    onClick={() => void createPage(directory.id)}
                    title="新建页面"
                  >
                    +页面
                  </button>
                  <button
                    type="button"
                    className="ml-0.5 px-1 text-[11px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--danger)]"
                    onClick={() => void removeDirectory(directory.id)}
                    title="删除目录"
                  >
                    ✕
                  </button>
                </div>
                {pages.map((page) => (
                  <div
                    key={page.id}
                    role="button"
                    tabIndex={0}
                    className={`group flex cursor-pointer items-center gap-1.5 rounded py-1 pr-2 pl-6 text-[12px] outline-none ${
                      selectedId === page.id
                        ? "bg-[var(--accent-soft)] text-[var(--text-strong)]"
                        : "text-[var(--text-3)] hover:bg-[var(--raised)]"
                    }`}
                    onClick={() => onSelect(page.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onSelect(page.id)
                      }
                    }}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        page.status === "confirmed"
                          ? "bg-[var(--success)]"
                          : "bg-[var(--pin-idle)]"
                      }`}
                      title={page.status === "confirmed" ? "已确认" : "草稿"}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {page.title || page.name}
                    </span>
                    {page.commentCount > 0 && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {page.commentCount}
                      </span>
                    )}
                    <button
                      type="button"
                      className="px-0.5 text-[11px] text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--danger)]"
                      onClick={(event) => {
                        event.stopPropagation()
                        void removePage(page.id)
                      }}
                      title="删除页面"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {!pages.length && (
                  <p className="py-1 pr-3 pl-6 text-[11px] text-[var(--text-faint)]">
                    {query ? "无匹配页面" : "暂无页面"}
                  </p>
                )}
              </div>
            )
          })
        ) : (
          <p className="px-3 py-2 text-[11px] leading-5 text-[var(--text-faint)]">
            {query
              ? "没有匹配的页面；换个关键词试试。"
              : "还没有目录；点右上「+ 目录」或让 agent 创建。"}
          </p>
        )}
      </div>
    </aside>
  )
}
