import { useEffect, useRef, useState } from "react"
import type { Comment, PageDetail } from "./types"

export function Comments({
  detail,
  focusId,
  onAdd,
}: {
  detail: PageDetail | null
  focusId: string | null
  onAdd: (target: string, text: string) => Promise<void>
}) {
  const [draft, setDraft] = useState("")
  const itemsRef = useRef<Map<string, HTMLElement>>(new Map())
  const comments = detail?.comments ?? []
  useEffect(() => {
    if (!focusId) return
    itemsRef.current.get(focusId)?.scrollIntoView({ block: "nearest" })
  }, [focusId, comments.length])
  const item = (comment: Comment, highlight: boolean) => (
    <div
      key={comment.id}
      ref={(node) => {
        if (node) itemsRef.current.set(comment.id, node)
        else itemsRef.current.delete(comment.id)
      }}
      className={`rounded-lg p-2.5 transition-shadow ${
        highlight ? "bg-[#383838] ring-1 ring-[#0d99ff]" : "bg-[#383838]"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            comment.author === "agent"
              ? "bg-[#a259ff]/15 text-[#c084fc]"
              : "bg-[#0d99ff]/15 text-[#66b8ff]"
          }`}
        >
          {comment.author === "agent" ? "Agent" : "用户"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-neutral-500">
          {comment.target || "整页评论"}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[12px] leading-5 text-neutral-200">
        {comment.text}
      </p>
    </div>
  )
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto bg-[#2c2c2c]">
      <div className="px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold tracking-wide text-neutral-500">
          评论（{comments.length}）
        </span>
      </div>
      {detail && (
        <div className="px-3 pb-3 pt-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="整页评论，或直接点画布中的元素圈评…"
            className="h-14 w-full resize-none rounded bg-[#383838] p-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0d99ff]"
          />
          <div className="mt-1.5 text-right">
            <button
              type="button"
              disabled={!draft.trim()}
              className="rounded bg-[#0d99ff] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#33aaff] disabled:opacity-40"
              onClick={() =>
                void onAdd("", draft.trim()).then(() => setDraft(""))
              }
            >
              添加整页评论
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 px-3 pb-6">
        {comments.map((comment) => item(comment, focusId === comment.id))}
        {detail && !comments.length && (
          <p className="py-4 text-center text-[11px] text-neutral-600">
            还没有评论；圈选元素或写整页评论。
          </p>
        )}
      </div>
    </aside>
  )
}
