import { useState } from "react"
import { homeData } from "@/features/home/mock-data"
import { AppShell } from "@/features/home/app-shell"
import { HomeComposer } from "@/features/home/home-composer"
import { ConversationPage } from "@/features/conversation/conversation-page"
import { ConversationMessageView } from "@/features/conversation/messages/conversation-message-view"
import { ConversationComposer } from "@/features/conversation/composer/conversation-composer"
import { QuestionComposer } from "@/features/conversation/composer/question-composer"
import { QueueDock } from "@/features/conversation/composer/queue-dock"
import { useConversations } from "@/features/conversation/use-conversations"
import type { ConversationReadingPosition } from "@/features/conversation/conversation-list"
import {
  conversationReadVersion,
  conversationStatus,
} from "@/features/conversation/conversation-status"
export default function App() {
  const { sessions, dispatch } = useConversations()
  const [selected, setSelected] = useState<string>()
  const [readVersions, setReadVersions] = useState<Record<string, string>>({})
  function selectConversation(id?: string) {
    setReadVersions((versions) => {
      const next = { ...versions }
      for (const session of sessions) {
        if (session.id === selected || session.id === id)
          next[session.id] = conversationReadVersion(session)
      }
      return next
    })
    setSelected(id)
  }
  const [positions] = useState(
    () => new Map<string, ConversationReadingPosition>()
  )
  const [homeDraft, setHomeDraft] = useState<{
    key: number
    workspaceId?: string
  }>({ key: 0 })
  const [workspaces, setWorkspaces] = useState(homeData.workspaces)
  const current = sessions.find((s) => s.id === selected)
  const data = {
    ...homeData,
    workspaces,
    conversations: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      workspaceId: s.workspaceId,
      updatedLabel:
        homeData.conversations.find((c) => c.id === s.id)?.updatedLabel ??
        "刚刚",
      message: s.messages.at(-1)?.text,
      status: conversationStatus(
        s,
        selected === s.id || readVersions[s.id] === conversationReadVersion(s)
      ),
    })),
  }
  let turn = 0
  return (
    <AppShell
      data={data}
      activeConversationId={selected}
      onSelectConversation={(item) => selectConversation(item.id)}
      onNew={(workspaceId) => {
        selectConversation(undefined)
        setHomeDraft((v) => ({ key: v.key + 1, workspaceId }))
      }}
    >
        {current ? (
          <ConversationPage
            viewKey={current.id}
            title={current.title}
            workspacePath={
              workspaces.find((w) => w.id === current.workspaceId)?.path ??
              current.workspaceId
            }
            status={
              current.phase === "running"
                ? "正在生成"
                : current.phase === "stopping"
                  ? "正在停止"
                  : current.phase === "waiting"
                    ? "等待回答"
                    : ""
            }
            state={current.loadState}
            error={current.error}
            connectionMessage={current.connectionMessage}
            readingPositions={positions}
            items={current.messages.map((message, index) => ({
              id: message.id,
              revision: message.text + message.status,
              content: (
                <ConversationMessageView
                  message={message}
                  onRetry={
                    index === current.messages.length - 1 &&
                    current.phase === "idle"
                      ? () => dispatch({ type: "retry", id: current.id })
                      : undefined
                  }
                />
              ),
              ...(message.role === "user"
                ? {
                    turn: ++turn,
                    prompt: message.text,
                    response: current.messages[index + 1]?.text,
                  }
                : {}),
            }))}
            question={
              current.questions?.length ? (
                <QuestionComposer
                  key={current.id}
                  questions={current.questions}
                  draft={current.questionDraft}
                  onDraftChange={(draft) =>
                    dispatch({ type: "question-draft", id: current.id, draft })
                  }
                  onAnswer={(answers) =>
                    dispatch({ type: "answer", id: current.id, answers })
                  }
                  onCancel={() => dispatch({ type: "cancel", id: current.id })}
                  onStop={() => dispatch({ type: "stop", id: current.id })}
                  stopping={current.phase === "stopping"}
                />
              ) : undefined
            }
            composer={
              <ConversationComposer
                key={current.id}
                data={data}
                draft={current.draft}
                workspacePath={
                  workspaces.find((w) => w.id === current.workspaceId)?.path ??
                  current.workspaceId
                }
                running={current.phase === "running"}
                stopping={current.phase === "stopping"}
                blocked={Boolean(current.connectionMessage)}
                onChange={(draft) =>
                  dispatch({ type: "change", id: current.id, draft })
                }
                onSubmit={(draft) =>
                  dispatch({
                    type: "send",
                    id: current.id,
                    draft,
                    key: crypto.randomUUID(),
                  })
                }
                onStop={() => dispatch({ type: "stop", id: current.id })}
                context={{
                  usedTokens: current.compacted ? 26000 : 53760,
                  contextWindow: 128000,
                  onCompact: () =>
                    dispatch({ type: "compact", id: current.id }),
                  compactDisabledReason:
                    current.phase !== "idle"
                      ? "请等待当前工作结束后压缩"
                      : current.compacted
                        ? "已完成模拟压缩"
                        : undefined,
                }}
                dock={
                  <QueueDock
                    items={current.queue}
                    running={current.phase === "running"}
                    busy={current.phase === "stopping"}
                    deliveryMode={current.deliveryMode ?? "single"}
                    onDeliveryModeChange={(mode) =>
                      dispatch({ type: "mode", id: current.id, mode })
                    }
                    onEdit={(key, text) =>
                      dispatch({
                        type: "queue-edit",
                        id: current.id,
                        key,
                        text,
                      })
                    }
                    onRemove={(key) =>
                      dispatch({ type: "queue-remove", id: current.id, key })
                    }
                    onSendNow={(key) =>
                      dispatch({ type: "queue-send", id: current.id, key })
                    }
                  />
                }
              />
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <HomeComposer
              key={homeDraft.key}
              data={data}
              initialDraft={{ workspaceId: homeDraft.workspaceId }}
              onWorkspaceAdd={(workspace) =>
                setWorkspaces((list) =>
                  list.some((w) => w.id === workspace.id)
                    ? list
                    : [...list, workspace]
                )
              }
              onSubmit={(draft) => {
                const id = crypto.randomUUID()
                dispatch({ type: "create", id, draft })
                setSelected(id)
                return ""
              }}
            />
          </div>
        )}
    </AppShell>
  )
}
