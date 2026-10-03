import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import type { HomeDraft } from "@/features/home/home-types"
import { LiveConversationView } from "./live-conversation-view"

type Scenario =
  | "completed"
  | "running"
  | "failed"
  | "interrupted"
  | "loading"
  | "read-error"
  | "tool-execution"
  | "retrying"
  | "compacting"
  | "compaction-failed"
  | "unknown-context"
  | "restored-context"
  | "not-accepted"
  | "resend-after-history"
  | "not-accepted-interrupted"
function Example({ scenario }: { scenario: Scenario }) {
  const [phase, setPhase] = useState(scenario)
  const [retryAt] = useState(() => new Date(Date.now() + 20000).toISOString())
  const active = [
    "running",
    "tool-execution",
    "retrying",
    "compacting",
  ].includes(phase)
  const [draft, setDraft] = useState<HomeDraft>({
    workspaceId: "moon",
    model: homeData.models[0]!,
    thinking: "中等",
    text:
      scenario === "not-accepted" ||
      scenario === "resend-after-history" ||
      scenario === "not-accepted-interrupted"
        ? "读取 README.md，确认桌面端和浏览器共用同一个后端。"
        : "",
    materials: [],
    session: { toolIds: ["read"], instructionScope: "all" },
  })
  const snapshot: ConversationSnapshot = {
    id: "catalog-session",
    title: "核对启动说明",
    workspaceId: "moon",
    cwd: "H:/workspace/moon",
    inputAccepted:
      phase !== "not-accepted" &&
      phase !== "resend-after-history" &&
      phase !== "not-accepted-interrupted",
    clientRequestId: "catalog-request",
    epoch: "catalog-host",
    version: 1,
    runId: "catalog-run",
    modelId: draft.model,
    connectionId: "catalog",
    providerModelId: draft.model,
    thinking: "medium",
    phase: active
      ? "running"
      : phase === "not-accepted" || phase === "resend-after-history"
        ? "failed"
        : phase === "not-accepted-interrupted"
          ? "interrupted"
          : phase === "failed" || phase === "interrupted"
            ? phase
            : "completed",
    runtime: active
      ? {
          phase:
            phase === "tool-execution"
              ? "tool"
              : phase === "retrying"
                ? "retrying"
                : phase === "compacting"
                  ? "compacting"
                  : "responding",
          updatedAt: "2026-10-03T09:20:03Z",
          toolName: phase === "tool-execution" ? "powershell" : undefined,
          ...(phase === "retrying"
            ? {
                attempt: 2,
                maxAttempts: 3,
                retryAt,
                retrySource: "response",
                reason: "服务暂时繁忙。",
              }
            : {}),
        }
      : undefined,
    notice:
      phase === "compaction-failed"
        ? {
            kind: "compaction-failed",
            message:
              "本次上下文压缩未完成，已保留原有历史。可以继续对话，后续可能需要再次整理。",
            occurredAt: "2026-10-03T09:20:04Z",
            runId: "catalog-run",
          }
        : undefined,
    context:
      phase === "unknown-context" || phase === "compacting"
        ? undefined
        : {
            usedTokens: 53760,
            contextWindow: 128000,
            source: "pi-context-estimate",
            estimated: true,
            observedAt: "2026-10-03T09:20:03Z",
            restored: phase === "restored-context",
          },
    contextState:
      phase === "unknown-context" || phase === "compacting"
        ? {
            status:
              phase === "compacting" ? "awaiting-response" : "unavailable",
            contextWindow: 128000,
            observedAt: "2026-10-03T09:20:03Z",
            reason:
              phase === "compacting"
                ? "正在整理上下文，下一次模型回复后更新占用。"
                : "尚无可用的模型用量记录。",
          }
        : undefined,
    error:
      phase === "not-accepted" || phase === "resend-after-history"
        ? "所选模型已不可用，请重新选择模型。"
        : phase === "failed"
          ? "模型服务暂时不可用，请检查连接后继续。"
          : phase === "interrupted" || phase === "not-accepted-interrupted"
            ? "请求已停止。"
            : "",
    messages:
      phase === "not-accepted" || phase === "not-accepted-interrupted"
        ? []
        : [
            {
              id: "user-1",
              role: "user",
              status: "settled",
              time: "2026-10-03T09:20:00Z",
              text: "读取 README.md，确认桌面端和浏览器共用同一个后端。",
            },
            {
              id: "assistant-1",
              role: "assistant",
              status: active
                ? "streaming"
                : phase === "interrupted"
                  ? "interrupted"
                  : phase === "failed"
                    ? "failed"
                    : "settled",
              time: "2026-10-03T09:20:03Z",
              text: active
                ? "已读取启动说明，正在核对"
                : "启动顺序是先打开 Moon，再运行前端预览。浏览器通过桌面应用持有的后端读取数据。",
              tools: [
                {
                  id: "tool-1",
                  name: "read",
                  source: "Pi",
                  status: "success",
                  input: '{"path":"README.md"}',
                  result: "pnpm dev\npnpm tauri dev",
                },
                {
                  id: "tool-2",
                  name: "powershell",
                  source: "Pi",
                  status: phase === "tool-execution" ? "running" : "success",
                  input: '{"command":"Test-Path README.md"}',
                  result: phase === "tool-execution" ? "" : "True",
                  ...(phase === "tool-execution"
                    ? {}
                    : { exitCode: 0, durationMs: 840 }),
                },
              ],
            },
          ],
  }
  return (
    <div className="flex h-dvh flex-col">
      <LiveConversationView
        id="catalog-session"
        title="核对启动说明"
        workspacePath={snapshot.cwd}
        snapshot={
          phase === "loading" || phase === "read-error" ? undefined : snapshot
        }
        error={
          phase === "read-error" ? "暂时无法读取会话，请重新读取。" : undefined
        }
        data={{ ...homeData, materials: [], materialsEnabled: false }}
        draft={draft}
        onChange={setDraft}
        onSend={() => {
          setDraft((current) => ({ ...current, text: "" }))
          setPhase("running")
        }}
        onStop={() => setPhase("interrupted")}
        onContinue={() => setPhase("running")}
        onReload={() => setPhase("completed")}
      />
    </div>
  )
}
export default {
  id: "live-conversation-view",
  name: "真实对话页面",
  layer: "页面",
  group: "对话",
  source: "src/features/conversation/live-conversation-view.tsx",
  description: "正式对话页面，展示后端快照、Pi 工具结果和独立输入草稿。",
  boundary:
    "展示组件不调用服务；App 与 useLiveConversation 管理读写和轮询。此处仅使用隔离演示数据，不发起模型调用。",
  inputs: ["snapshot、error、pending、draft、data、positions"],
  events: ["onSend、onStop、onContinue、onReload、onChange"],
  composition: [
    "ConversationPage",
    "ConversationMessageView",
    "ConversationComposer",
    "Alert",
    "Button",
    "ExecutionFeedback",
  ],
  consumers: ["App"],
  viewport: { width: 1120, height: 820 },
  states: [
    {
      id: "completed",
      name: "多轮输入",
      condition: "上轮已完成",
      expected: "保留真实工具结果；可发送后续消息",
      render: () => <Example scenario="completed" />,
    },
    {
      id: "running",
      name: "流式回复",
      condition: "Pi 正在生成",
      expected: "主动作停止；仍可编辑下一条草稿；配置锁定",
      render: () => <Example scenario="running" />,
    },
    {
      id: "tool-execution",
      name: "工具执行中",
      condition: "Pi正在执行powershell",
      expected:
        "显示当前工具阶段；展开对应工具显示输入和等待结果；主动作可停止。",
      render: () => <Example scenario="tool-execution" />,
    },
    {
      id: "retrying",
      name: "自动重试等待",
      condition: "模型暂时不可用，Pi安排第2/3次重试",
      expected: "正文和草稿保留，反馈显示次数及倒计时，可停止等待。",
      render: () => <Example scenario="retrying" />,
    },
    {
      id: "compacting",
      name: "压缩上下文",
      condition: "Pi实际开始压缩",
      expected: "阶段明确为压缩，不能声称回复或任务成功；用量待更新。",
      render: () => <Example scenario="compacting" />,
    },
    {
      id: "compaction-failed",
      name: "压缩未完成但回复结束",
      condition: "回复结束后自动压缩失败",
      expected: "轻提示保留原因，不将已结束回复强制设为失败；可正常继续输入。",
      render: () => <Example scenario="compaction-failed" />,
    },
    {
      id: "unknown-context",
      name: "没有上下文记录",
      condition: "服务未报告用量",
      expected: "入口未知，展开解释原因，不能显示0%。",
      render: () => <Example scenario="unknown-context" />,
    },
    {
      id: "restored-context",
      name: "历史统计恢复",
      condition: "重新打开已保存历史",
      expected: "用量详情注明历史恢复和原观察时间。",
      render: () => <Example scenario="restored-context" />,
    },
    {
      id: "failed",
      name: "请求失败",
      condition: "服务调用失败",
      expected: "已接受请求保留真实用户历史，提供继续上次回复",
      render: () => <Example scenario="failed" />,
    },
    {
      id: "not-accepted",
      name: "消息未接受",
      condition: "首轮模型检查失败，inputAccepted=false且历史为空。",
      expected: "输入保留原文本，提示解决具体错误后重新发送，不提供无效继续动作。",
      render: () => <Example scenario="not-accepted" />,
    },
    {
      id: "resend-after-history",
      name: "后续消息未接受",
      condition: "已有历史，但最新发送在写入前失败，inputAccepted=false。",
      expected:
        "旧消息保留，新草稿可修改模型后重新发送，不能把旧历史当作本次可继续依据。",
      render: () => <Example scenario="resend-after-history" />,
    },
    {
      id: "not-accepted-interrupted",
      name: "写入前已停止",
      condition: "消息写入前被停止或宿主重启恢复为中断，inputAccepted=false。",
      expected:
        "保持中性停止反馈与原输入，提供重新发送指引，不把中断状态误判为可继续。",
      render: () => <Example scenario="not-accepted-interrupted" />,
    },
    {
      id: "interrupted",
      name: "已停止",
      condition: "用户停止生成",
      expected: "保留结果，可继续上次回复或发送新请求",
      render: () => <Example scenario="interrupted" />,
    },
    {
      id: "loading",
      name: "读取历史",
      condition: "正文未返回",
      expected: "加载反馈不冒充空对话",
      render: () => <Example scenario="loading" />,
    },
    {
      id: "read-error",
      name: "读取失败",
      condition: "正文读取失败",
      expected: "可重新读取且输入草稿保留",
      render: () => <Example scenario="read-error" />,
    },
  ],
} satisfies CatalogEntry
