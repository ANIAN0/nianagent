import { useState } from "react"
import { api, message } from "./api"
import type { Snapshot } from "./types"

export function Tree({
  snapshot,
  selectedId,
  onSelect,
  onChange,
  onError,
}: {
  snapshot: Snapshot | null
  selectedId: string | null
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
    for (let attempt = 2; attempt < 20; attempt += 1) {
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
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col overflow-y-auto bg-[#2c2c2c]">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold tracking-wide text-neutral-500">
          目录
        </span>
        <button
          type="button"
          className="text-[11px] text-neutral-500 transition-colors hover:text-neutral-200"
          onClick={() => setCreating((value) => !value)}
        >
          + 目录
        </button>
      </div>
      {creating && (
        <div className="flex gap-1.5 px-3 py-1.5">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createDirectory()
            }}
            placeholder="目录名"
            className="min-w-0 flex-1 rounded bg-[#383838] px-2 py-1 text-xs text-neutral-200 outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0d99ff]"
          />
          <button
            type="button"
            className="rounded bg-[#0d99ff] px-2 text-xs font-medium text-white"
            onClick={() => void createDirectory()}
          >
            添加
          </button>
        </div>
      )}
      {snapshot?.directories.length ? (
        snapshot.directories.map((directory) => {
          const pages = snapshot.pages.filter(
            (page) => page.directoryId === directory.id
          )
          return (
            <div key={directory.id} className="pb-1 pt-2">
              <div className="group flex items-center px-3 py-1">
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-300">
                  {directory.name}
                </span>
                <button
                  type="button"
                  className="ml-1 px-1 text-[11px] text-neutral-500 opacity-0 transition-opacity hover:text-[#0d99ff] group-hover:opacity-100"
                  onClick={() => void createPage(directory.id)}
                  title="新建页面"
                >
                  +页面
                </button>
                <button
                  type="button"
                  className="ml-0.5 px-1 text-[11px] text-neutral-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  onClick={() => void removeDirectory(directory.id)}
                  title="删除目录"
                >
                  ✕
                </button>
              </div>
              {pages.map((page) => (
                <div
                  key={page.id}
                  className={`group flex cursor-pointer items-center gap-1.5 py-1 pl-6 pr-2 text-[12px] ${
                    selectedId === page.id
                      ? "bg-[#0d99ff]/20 text-neutral-100"
                      : "text-neutral-400 hover:bg-[#383838]"
                  }`}
                  onClick={() => onSelect(page.id)}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      page.status === "confirmed"
                        ? "bg-emerald-400"
                        : "bg-neutral-600"
                    }`}
                    title={page.status === "confirmed" ? "已确认" : "草稿"}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {page.title || page.name}
                  </span>
                  {page.commentCount > 0 && (
                    <span className="text-[10px] text-neutral-500">
                      {page.commentCount}
                    </span>
                  )}
                  <button
                    type="button"
                    className="px-0.5 text-[11px] text-neutral-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
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
                <p className="py-1 pl-6 pr-3 text-[11px] text-neutral-600">
                  暂无页面
                </p>
              )}
            </div>
          )
        })
      ) : (
        <p className="px-3 py-2 text-[11px] leading-5 text-neutral-600">
          还没有目录；点右上「+ 目录」或让 agent 创建。
        </p>
      )}
    </aside>
  )
}
