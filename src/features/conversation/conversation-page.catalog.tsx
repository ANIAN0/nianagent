import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { homeData } from "../home/mock-data"
import { ConversationPage } from "./conversation-page"
import { ConversationComposer } from "./composer/conversation-composer"
import { QueueDock } from "./composer/queue-dock"
import { QuestionComposer } from "./composer/question-composer"
import { ConversationMessageView } from "./messages/conversation-message-view"
import { initialSessions } from "./mock-conversations"
import { useConversations } from "./use-conversations"

type Scenario =
  | "ready"
  | "empty"
  | "loading"
  | "error"
  | "disconnected"
  | "long-markdown"
  | "failed"
  | "stopped-queue"
  | "questions"
  | "attachments"
  | "long-draft"
function Example({ scenario = "ready" }: { scenario?: Scenario }) {
  const [loadState, setLoadState] = useState<"ready" | "loading" | "error">(
    scenario === "loading" || scenario === "error" ? scenario : "ready"
  )
  const { sessions, dispatch } = useConversations(() => {
    const all = initialSessions()
    const index =
      scenario === "long-markdown"
        ? 1
        : scenario === "failed" || scenario === "stopped-queue"
          ? 2
          : scenario === "questions"
            ? 3
            : scenario === "attachments"
              ? 4
              : 0
    const session = all[index]
    if (scenario === "empty") session.messages = []
    if (scenario === "long-draft") {
      session.draft.text = Array.from(
        { length: 20 },
        (_, index) =>
          `${index + 1}. 保留现有交互，核对本轮修改涉及的组件与使用场景。`
      ).join("\n")
      session.draft.materials = homeData.materials.slice(0, 2)
    }
    if (scenario === "failed") {
      session.messages = session.messages.slice(0, 2)
      session.queue = []
    }
    return [session]
  })
  const session = sessions[0]
  const workspace = homeData.workspaces.find(
    (item) => item.id === session.workspaceId
  )!
  const running = session.phase === "running"
  const stopping = session.phase === "stopping"
  let turn = 0
  return (
    <div style={{ height: "100dvh" }}>
      <ConversationPage
        keepComposer
        viewKey={session.id}
        title={session.title}
        workspacePath={workspace.path}
        state={loadState}
        status={
          running
            ? "正在工作"
            : stopping
              ? "正在停止"
              : session.questions
                ? "等待回答"
                : undefined
        }
        connectionMessage={
          scenario === "disconnected"
            ? "连接已断开，正在恢复会话状态。"
            : undefined
        }
        onRetry={() => setLoadState("ready")}
        items={session.messages.map((message, index) => ({
          id: message.id,
          turn: message.role === "user" ? ++turn : undefined,
          prompt: message.text,
          response: session.messages[index + 1]?.text,
          content: (
            <ConversationMessageView
              message={message}
              onRetry={
                index === session.messages.length - 1 &&
                session.phase === "idle"
                  ? () => dispatch({ type: "retry", id: session.id })
                  : undefined
              }
            />
          ),
        }))}
        question={
          session.questions && (
            <QuestionComposer
              key={session.id}
              questions={session.questions}
              draft={session.questionDraft}
              onDraftChange={(draft) =>
                dispatch({ type: "question-draft", id: session.id, draft })
              }
              onAnswer={(answers) =>
                dispatch({ type: "answer", id: session.id, answers })
              }
              onCancel={() => dispatch({ type: "cancel", id: session.id })}
              onStop={() => dispatch({ type: "stop", id: session.id })}
              stopping={stopping}
            />
          )
        }
        composer={
          <ConversationComposer
            deliveryMode={session.deliveryMode ?? "single"}
            queuedCount={session.queue.length}
            onDeliveryModeChange={(mode) =>
              dispatch({ type: "mode", id: session.id, mode })
            }
            data={homeData}
            draft={session.draft}
            workspacePath={workspace.path}
            running={running}
            stopping={stopping}
            blocked={scenario === "disconnected" || loadState !== "ready"}
            blockedReason={
              loadState !== "ready"
                ? "会话尚未读取完成，草稿保留；请先重新读取会话。"
                : scenario === "disconnected"
                  ? "请先重新读取会话，草稿仍可编辑。"
                  : undefined
            }
            onChange={(draft) =>
              dispatch({ type: "change", id: session.id, draft })
            }
            onSubmit={(draft) =>
              dispatch({
                type: "send",
                id: session.id,
                draft,
                key: crypto.randomUUID(),
              })
            }
            onStop={() => dispatch({ type: "stop", id: session.id })}
            context={{
              usedTokens: session.compacted ? 25600 : 54120,
              contextWindow: 128000,
              onCompact: () => dispatch({ type: "compact", id: session.id }),
              compactDisabledReason:
                loadState !== "ready"
                  ? "请先重新读取会话。"
                  : session.phase !== "idle"
                    ? "当前工作结束后可压缩"
                    : session.compacted
                      ? "当前上下文已整理"
                      : undefined,
            }}
            dock={
              <QueueDock
                items={session.queue}
                running={running}
                busy={stopping}
                deliveryMode={session.deliveryMode ?? "single"}
                onEdit={(key, text) =>
                  dispatch({ type: "queue-edit", id: session.id, key, text })
                }
                onRemove={(key) =>
                  dispatch({ type: "queue-remove", id: session.id, key })
                }
                onSendNow={(key) =>
                  dispatch({ type: "queue-send", id: session.id, key })
                }
              />
            }
          />
        }
      />
    </div>
  )
}
export default {
  id: "conversation-page",
  name: "Moon 对话页面",
  layer: "页面",
  group: "工作空间",
  source: "src/features/conversation/conversation-page.tsx",
  description:
    "复用正式会话与模拟调度，覆盖多轮阅读、执行过程、附件、问答及恢复工作。",
  boundary:
    "页面负责阅读与输入区域布局；展示宿主提供隔离的会话状态，不读取或写入用户文件。",
  inputs: [
    "viewKey / title / state / items：当前会话、消息与加载状态。",
    "composer / question：普通输入与问题卡槽。",
    "connectionMessage：断线提示；发送限制由宿主提供。",
  ],
  events: [
    "onRetry：重新读取会话。",
    "onReadingPositionChange：保存会话阅读位置。",
  ],
  composition: [
    "ConversationHeader、ConversationList、ConversationMessageView、ConversationComposer、QueueDock、QuestionComposer",
  ],
  consumers: ["App"],
  viewport: { width: 1120, height: 760 },
  states: [
    {
      id: "ready",
      name: "多轮审查",
      condition: "首页交互审查的两轮对话，含表格与嵌套清单。",
      expected: "段落、表格、清单和操作栏层次清楚；执行过程可展开。",
      render: () => <Example />,
    },
    {
      id: "long-markdown",
      name: "代码与多步骤执行",
      condition: "目录结构方案，含代码、diff、表格与穿插工具调用。",
      expected: "正文与工具按顺序阅读，长代码不撑破页面。",
      render: () => <Example scenario="long-markdown" />,
    },
    {
      id: "failed",
      name: "工具失败与重试",
      condition: "预置端口占用失败。",
      expected: "能查看错误详情并重试；重试后产生成功回复。",
      render: () => <Example scenario="failed" />,
    },
    {
      id: "stopped-queue",
      name: "停止后保留队列",
      condition: "已中断回复，下方保留两项补充需求。",
      expected: "中断与未执行工具可区分；队列可以继续发送、编辑或删除。",
      render: () => <Example scenario="stopped-queue" />,
    },
    {
      id: "questions",
      name: "单选、多选与自由回答",
      condition: "整理周报前的三项问题。",
      expected: "可前后切换、跳过、收起或提交；提交后恢复普通输入。",
      render: () => <Example scenario="questions" />,
    },
    {
      id: "attachments",
      name: "图片与长文件名",
      condition: "已有本地标识图片和两份文字材料。",
      expected: "图片与文件能预览；长文件名不挤压消息布局。",
      render: () => <Example scenario="attachments" />,
    },
    {
      id: "long-draft",
      name: "长草稿与材料",
      condition: "20行草稿与两份材料。",
      expected:
        "正文在输入框内部滚动，材料与发送控件始终可达；不会挤出消息阅读区。",
      render: () => <Example scenario="long-draft" />,
    },
    {
      id: "empty",
      name: "空会话",
      condition: "尚无消息。",
      expected:
        "发送后进入正常会话布局。输入“模拟失败”可查看失败，输入“问我”可进入问题流程。",
      render: () => <Example scenario="empty" />,
    },
    {
      id: "loading",
      name: "正在读取",
      condition: "读取会话。",
      expected: "显示读取提示，暂不展示输入区。",
      render: () => <Example scenario="loading" />,
    },
    {
      id: "error",
      name: "读取失败",
      condition: "加载失败。",
      expected: "重新读取恢复消息与草稿。",
      render: () => <Example scenario="error" />,
    },
    {
      id: "disconnected",
      name: "断线保留阅读",
      condition: "断线状态。",
      expected: "仍能阅读已有消息，暂不可发送。",
      render: () => <Example scenario="disconnected" />,
    },
  ],
} satisfies CatalogEntry
