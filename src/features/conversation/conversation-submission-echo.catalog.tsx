import type { CatalogEntry } from "../../../ui-catalog/catalog"
import type { HomeDraft } from "@/features/home/home-types"
import type { PendingSubmission } from "./conversation-draft-store"
import { conversationSubmissionEcho } from "./conversation-submission"
import { ConversationSubmissionEcho } from "./conversation-submission-echo"

const nextDraft: HomeDraft = {
  workspaceId: "demo",
  text: "下一稿只保留，不随继续请求发送。",
  model: "demo/model",
  thinking: "关闭",
  materials: [
    { id: "next-material", name: "下一稿材料.md", kind: "附件", type: "file" },
  ],
  session: { toolIds: [], instructionScope: "none" },
}

function Preview({
  kind = "retry",
  stage = "sending",
  pending = false,
}: {
  kind?: "send" | "retry"
  stage?: PendingSubmission["stage"]
  pending?: boolean
}) {
  const request: PendingSubmission =
    kind === "retry"
      ? {
          id: "original-retry",
          kind,
          stage,
          signature: "retry",
          draft: nextDraft,
          input: {
            sessionId: "demo",
            connectionId: "demo",
            modelId: "model",
            thinking: "off",
          },
        }
      : {
          id: "original-send",
          kind,
          stage,
          signature: "send",
          draft: { ...nextDraft, text: "实际提交的原消息", materials: [] },
          input: {
            sessionId: "demo",
            workspaceId: "demo",
            text: "实际提交的原消息",
            materials: [],
            connectionId: "demo",
            modelId: "model",
            thinking: "off",
          },
        }
  const presentation = conversationSubmissionEcho(request)
  return (
    <div className="flex flex-col gap-6 p-4">
      {presentation && (
        <ConversationSubmissionEcho
          submission={presentation}
          pending={pending}
          unconfirmed={!pending}
        />
      )}
      <div className="rounded-2xl border bg-card p-4 text-sm">
        <p className="mb-2 text-xs text-muted-foreground">独立的下一稿</p>
        <p>{nextDraft.text}</p>
        <p className="mt-2 text-muted-foreground">
          {nextDraft.materials[0]!.name}
        </p>
      </div>
    </div>
  )
}

export default {
  id: "conversation-submission-echo",
  name: "会话原操作回显",
  layer: "复合组件",
  group: "会话",
  source: "src/features/conversation/conversation-submission-echo.tsx",
  description:
    "原消息展示其提交副本；继续操作只展示原操作状态，下一稿和材料不冒充提交内容。",
  boundary:
    "由正式submission kind投影，不读取当前编辑草稿；接受/拒绝终态不再展示提交中回显。",
  inputs: ["submission.id/kind/stage", "send专属draft", "pending/unconfirmed"],
  events: [],
  composition: ["UserMessage", "Lucide"],
  consumers: ["LiveConversationView"],
  viewport: { width: 680, height: 300 },
  states: [
    {
      id: "send",
      name: "原消息待核对",
      condition: "kind=send",
      expected: "显示真正发送的原消息，不展示独立下一稿。",
      render: () => <Preview kind="send" />,
    },
    {
      id: "retry-prepared",
      name: "继续操作准备中",
      condition: "kind=retry/stage=prepared",
      expected: "继续操作的等待状态不展示草稿和材料为用户消息。",
      render: () => <Preview stage="prepared" pending />,
    },
    {
      id: "retry-sending",
      name: "正在继续",
      condition: "kind=retry/stage=sending/pending",
      expected: "明确下一稿与材料未随继续请求发送。",
      render: () => <Preview pending />,
    },
    {
      id: "retry-unknown",
      name: "继续结果未知",
      condition: "kind=retry/stage=sending/没有RPC等待",
      expected: "保留原继续请求状态和下一稿，等待核对，不伪装失败或再次提交。",
      render: () => <Preview />,
    },
    {
      id: "retry-accepted",
      name: "继续已接受",
      condition: "kind=retry/stage=accepted",
      expected: "提交回显撤下；独立下一稿仍保留。",
      render: () => <Preview stage="accepted" />,
    },
    {
      id: "retry-rejected",
      name: "继续已拒绝",
      condition: "kind=retry/stage=rejected",
      expected: "提交回显撤下，不拼接或清空下一稿。",
      render: () => <Preview stage="rejected" />,
    },
  ],
} satisfies CatalogEntry
