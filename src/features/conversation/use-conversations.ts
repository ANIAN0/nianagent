import { useEffect, useReducer } from "react"
import type { HomeDraft } from "../home/home-types"
import type {
  ConversationSession,
  QuestionAnswer,
  QuestionDraft,
} from "./conversation-types"
import {
  emptyDraft,
  initialSessions,
  mockReply,
  noteQuestions,
} from "./mock-conversations"

type Session = ConversationSession & {
  deliveryMode?: "single" | "all"
  generation?: { target: string; ask: boolean; fail: boolean }
  compacted?: boolean
}
type Action =
  | { type: "create"; id: string; draft: HomeDraft }
  | { type: "tick" }
  | { type: "change"; id: string; draft: HomeDraft }
  | { type: "send"; id: string; draft: HomeDraft; key: string }
  | { type: "stop" | "retry" | "cancel" | "compact"; id: string }
  | { type: "queue-edit"; id: string; key: string; text: string }
  | { type: "queue-remove" | "queue-send"; id: string; key: string }
  | { type: "mode"; id: string; mode: "single" | "all" }
  | { type: "question-draft"; id: string; draft: QuestionDraft }
  | { type: "answer"; id: string; answers: QuestionAnswer[] }

function begin(
  session: Session,
  draft: HomeDraft,
  key: string,
  recovered = false
): Session {
  const text =
    draft.text.trim() || (draft.materials.length ? "请查看附带的材料。" : "")
  if (!text) return session
  const tools = draft.session.toolIds.includes("read")
    ? [
        {
          id: `${key}-tool`,
          name: "读取文件",
          source: "模拟工具",
          status: "running" as const,
          input: "README.md",
          result: "等待模拟结果…",
        },
      ]
    : undefined
  return {
    ...session,
    phase: "running",
    questions: undefined,
    questionDraft: undefined,
    connectionMessage: undefined,
    draft: { ...draft, text: "", materials: [] },
    generation: {
      target: mockReply(text, recovered),
      ask: !recovered && /确认|问我/.test(text),
      fail: !recovered && /模拟失败|模拟超时/.test(text),
    },
    messages: [
      ...session.messages,
      {
        id: `${key}-u`,
        role: "user",
        time: new Date().toISOString(),
        text,
        status: "settled",
        attachments: draft.materials.map((m) => ({
          id: m.id,
          name: m.name,
          kind: "file",
          content:
            m.kind === "Skill"
              ? `已选择 Skill：${m.name}`
              : "附件示例：仅保存了文件名称，未读取本地内容。",
        })),
      },
      {
        id: `${key}-a`,
        role: "assistant",
        time: new Date().toISOString(),
        text: "",
        status: "streaming",
        model: draft.modelLabel ?? draft.model,
        thinking: { text: "正在整理本次需求和工作上下文。" },
        tools,
      },
    ],
  }
}
function stop(session: Session): Session {
  return {
    ...session,
    phase: "idle",
    generation: undefined,
    questions: undefined,
    questionDraft: undefined,
    messages: session.messages.map((m) =>
      m.status === "streaming"
        ? {
            ...m,
            status: "interrupted",
            tools: m.tools?.map((t) =>
              t.status === "running" ? { ...t, status: "stopped" } : t
            ),
          }
        : m
    ),
  }
}
function reducer(sessions: Session[], action: Action): Session[] {
  if (action.type === "create")
    return [
      begin(
        {
          id: action.id,
          title:
            action.draft.text.trim().slice(0, 40) ||
            action.draft.materials[0]?.name ||
            "新会话",
          workspaceId: action.draft.workspaceId,
          draft: emptyDraft(action.draft.workspaceId),
          phase: "idle",
          loadState: "ready",
          messages: [],
          queue: [],
        },
        action.draft,
        action.id
      ),
      ...sessions,
    ]
  if (action.type === "tick")
    return sessions.map((session) => {
      if (session.phase === "stopping") return stop(session)
      if (session.phase !== "running" || !session.generation) return session
      const generation = session.generation
      const last = session.messages.at(-1)!
      const text = generation.target.slice(0, last.text.length + 7)
      const done = text.length === generation.target.length
      const next: Session = {
        ...session,
        messages: [
          ...session.messages.slice(0, -1),
          {
            ...last,
            text,
            status: done
              ? generation.fail
                ? "failed"
                : "settled"
              : "streaming",
            tools: last.tools?.map((t) => ({
              ...t,
              status:
                done && generation.fail
                  ? "failed"
                  : done || (!generation.fail && text.length > 80)
                    ? "success"
                    : "running",
              result:
                done && generation.fail
                  ? "模拟连接超时，未访问文件系统。可以重试。"
                  : done || (!generation.fail && text.length > 80)
                    ? "已读取示例上下文（未访问文件系统）。"
                    : "等待模拟结果…",
            })),
          },
        ],
        phase: done ? "idle" : "running",
      }
      if (done) {
        next.generation = undefined
        if (generation.ask && !generation.fail)
          return {
            ...next,
            phase: "waiting",
            questions: structuredClone(noteQuestions).map((question) => ({
              ...question,
              id: `${session.id}-${question.id}`,
            })),
          }
        if (next.queue.length && !generation.fail) {
          const selected =
            next.deliveryMode === "all" ? next.queue : [next.queue[0]]
          const draft = {
            ...next.draft,
            text: selected.map((q) => q.draft.text).join("\n\n"),
            materials: selected
              .flatMap((q) => q.draft.materials)
              .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i),
          }
          return {
            ...begin(
              { ...next, queue: next.queue.slice(selected.length) },
              draft,
              selected[0].id
            ),
            draft: next.draft,
          }
        }
      }
      return next
    })
  return sessions.map((session) => {
    if (session.id !== action.id) return session
    switch (action.type) {
      case "change":
        return { ...session, draft: action.draft }
      case "send":
        return session.phase === "running" || session.phase === "waiting"
          ? {
              ...session,
              queue: [
                ...session.queue,
                { id: action.key, draft: action.draft },
              ],
              draft: { ...action.draft, text: "", materials: [] },
            }
          : begin(session, action.draft, action.key)
      case "stop":
        return { ...session, phase: "stopping" }
      case "cancel":
        return stop(session)
      case "compact":
        return { ...session, compacted: true }
      case "mode":
        return { ...session, deliveryMode: action.mode }
      case "queue-edit":
        return {
          ...session,
          queue: session.queue.map((q) =>
            q.id === action.key
              ? { ...q, draft: { ...q.draft, text: action.text } }
              : q
          ),
        }
      case "queue-remove":
        return {
          ...session,
          queue: session.queue.filter((q) => q.id !== action.key),
        }
      case "queue-send": {
        const q = session.queue.find((q) => q.id === action.key)
        return q
          ? {
              ...begin(
                {
                  ...session,
                  messages: session.messages.map((m) =>
                    m.status === "streaming"
                      ? {
                          ...m,
                          status: "settled",
                          tools: m.tools?.map((t) =>
                            t.status === "running"
                              ? {
                                  ...t,
                                  status: "success",
                                  result: "已将补充需求加入当前工作（模拟）。",
                                }
                              : t
                          ),
                        }
                      : m
                  ),
                  queue: session.queue.filter((q) => q.id !== action.key),
                },
                {
                  ...session.draft,
                  text: q.draft.text,
                  materials: q.draft.materials,
                },
                q.id
              ),
              draft: session.draft,
            }
          : session
      }
      case "question-draft":
        return { ...session, questionDraft: action.draft }
      case "answer": {
        const next = begin(
          session,
          {
            ...session.draft,
            text: action.answers
              .map(
                (answer) =>
                  `${session.questions?.find((q) => q.id === answer.id)?.header ?? "回答"}：${[...answer.selected, answer.custom].filter(Boolean).join("、") || "跳过"}`
              )
              .join("\n"),
            materials: [],
          },
          `${session.id}-${session.messages.length}-answer`
        )
        return {
          ...next,
          generation: next.generation
            ? { ...next.generation, ask: false }
            : undefined,
          draft: session.draft,
        }
      }
      case "retry": {
        const lastUser = session.messages.findLastIndex(
          (m) => m.role === "user"
        )
        if (lastUser < 0) return session
        const user = session.messages[lastUser]
        const next = begin(
          { ...session, messages: session.messages.slice(0, lastUser) },
          { ...session.draft, text: user.text, materials: [] },
          `${session.id}-${lastUser}-retry`,
          true
        )
        next.messages[next.messages.length - 2] = user
        return { ...next, draft: session.draft }
      }
    }
  })
}
export function useConversations(
  seed: () => ConversationSession[] = initialSessions
) {
  const [sessions, dispatch] = useReducer(reducer, undefined, (): Session[] =>
    seed()
  )
  const active = sessions.some(
    (s) => s.phase === "running" || s.phase === "stopping"
  )
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => dispatch({ type: "tick" }), 100)
    return () => window.clearInterval(timer)
  }, [active])
  return { sessions, dispatch }
}
