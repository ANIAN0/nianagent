import { useEffect, useRef, useState } from "react"
import type { Comment, PageDetail } from "./types"

function CommentItem({
  comment,
  replies,
  highlight,
  focusRef,
  onReply,
  onResolve,
}: {
  comment: Comment
  replies: Comment[]
  highlight: boolean
  focusRef: (id: string, node: HTMLElement | null) => void
  onReply: (parent: Comment, text: string) => void
  onResolve: (comment: Comment, resolved: boolean) => void
}) {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState("")
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={(node) => focusRef(comment.id, node)}
        className={`rounded-lg p-2.5 transition-shadow ${
          highlight ? "bg-[#383838] ring-1 ring-[#0d99ff]" : "bg-[#383838]"
        } ${comment.resolved ? "opacity-55" : ""}`}
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
          <button
            type="button"
            title={comment.resolved ? "重新打开" : "标记已解决"}
            className={`rounded px-1 text-[11px] transition-colors ${
              comment.resolved
                ? "text-emerald-400"
                : "text-neutral-500 hover:text-emerald-400"
            }`}
            onClick={() => onResolve(comment, !comment.resolved)}
          >
            ✓
          </button>
          <button
            type="button"
            title="回复"
            className="rounded px-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-200"
            onClick={() => setReplying((value) => !value)}
          >
            ↩
          </button>
        </div>
        <p className="whitespace-pre-wrap text-[12px] leading-5 text-neutral-200">
          {comment.text}
        </p>
        {replying && (
          <div className="mt-2 flex flex-col gap-1.5">
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`回复 ${comment.author === "agent" ? "Agent" : "用户"}…`}
              className="h-12 w-full resize-none rounded bg-[#2c2c2c] p-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0d99ff]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-200"
                onClick={() => {
                  setReplying(false)
                  setDraft("")
                }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={!draft.trim()}
                className="rounded bg-[#0d99ff] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
                onClick={() => {
                  onReply(comment, draft.trim())
                  setDraft("")
                  setReplying(false)
                }}
              >
                回复
              </button>
            </div>
          </div>
        )}
      </div>
      {replies.length > 0 && (
        <div className="ml-4 flex flex-col gap-2 border-l border-[#3c3c3c] pl-2.5">
          {replies.map((reply) => (
            <div
              key={reply.id}
              ref={(node) => focusRef(reply.id, node)}
              className={`rounded-lg bg-[#333333] p-2 ${reply.resolved ? "opacity-55" : ""}`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    reply.author === "agent"
                      ? "bg-[#a259ff]/15 text-[#c084fc]"
                      : "bg-[#0d99ff]/15 text-[#66b8ff]"
                  }`}
                >
                  {reply.author === "agent" ? "Agent" : "用户"}
                </span>
                {reply.resolved && (
                  <span className="text-[10px] text-emerald-400">已解决</span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[12px] leading-5 text-neutral-300">
                {reply.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Comments({
  detail,
  focusId,
  onAdd,
  onAddReply,
  onResolve,
}: {
  detail: PageDetail | null
  focusId: string | null
  onAdd: (target: string, text: string) => Promise<void>
  onAddReply: (parentId: string, text: string) => Promise<void>
  onResolve: (commentId: string, resolved: boolean) => Promise<void>
}) {
  const [draft, setDraft] = useState("")
  const [showResolved, setShowResolved] = useState(true)
  const itemsRef = useRef<Map<string, HTMLElement>>(new Map())
  const comments = detail?.comments ?? []
  useEffect(() => {
    if (!focusId) return
    itemsRef.current.get(focusId)?.scrollIntoView({ block: "nearest" })
  }, [focusId, comments.length])
  const roots = comments.filter((comment) => !comment.parentId)
  const repliesOf = (commentId: string) =>
    comments.filter((comment) => comment.parentId === commentId)
  const visible = (comment: Comment) => showResolved || !comment.resolved
  const resolvedCount = comments.filter((comment) => comment.resolved).length
  const focusRef = (id: string, node: HTMLElement | null) => {
    if (node) itemsRef.current.set(id, node)
    else itemsRef.current.delete(id)
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold tracking-wide text-neutral-500">
          评论（{comments.length - resolvedCount}/{comments.length}）
        </span>
        {resolvedCount > 0 && (
          <button
            type="button"
            className="text-[11px] text-neutral-500 transition-colors hover:text-neutral-200"
            onClick={() => setShowResolved((value) => !value)}
          >
            {showResolved ? "隐藏已解决" : "显示已解决"}
          </button>
        )}
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
      <div className="flex flex-col gap-3 px-3 pb-6">
        {roots
          .filter(visible)
          .map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              replies={repliesOf(comment.id).filter(visible)}
              highlight={focusId === comment.id}
              focusRef={focusRef}
              onReply={(parent, text) => void onAddReply(parent.id, text)}
              onResolve={(comment, resolved) =>
                void onResolve(comment.id, resolved)
              }
            />
          ))}
        {detail && !comments.length && (
          <p className="py-4 text-center text-[11px] text-neutral-600">
            还没有评论；圈选元素或写整页评论。
          </p>
        )}
        {detail && comments.length > 0 && !roots.some(visible) && (
          <p className="py-4 text-center text-[11px] text-neutral-600">
            全部评论已解决。
          </p>
        )}
      </div>
    </div>
  )
}
