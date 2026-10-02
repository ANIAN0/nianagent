import { Button } from "@/components/ui/button"
import {
  createSessionService,
  SessionServiceContext,
  consumeHomeSession,
  readHomeWorkspaces,
} from "@/features/session/session-service"
import { thinkingLabels } from "@/features/home/model-thinking"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { createModelService } from "@/features/models/model-service"
import type { ModelConnection } from "@/features/models/model-types"
import {
  connectionIssue,
  modelSelectionId,
} from "@/features/models/model-types"
import type { LeaveGuard } from "@/features/models/connection-editor"
const ModelSettingsPage = lazy(() =>
  import("@/features/models/model-settings-page").then((module) => ({
    default: module.ModelSettingsPage,
  }))
)
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessionService] = useState(() => createSessionService())
  const [workspaceError, setWorkspaceError] = useState("")
  const [workspaceReload, setWorkspaceReload] = useState(0)
  const [modelService] = useState(() => createModelService())
  const [connections, setConnections] = useState<ModelConnection[]>([])
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({})
  const [modelLoading, setModelLoading] = useState(true)
  const [modelRefresh, setModelRefresh] = useState(0)
  const [modelLoadError, setModelLoadError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    modelService
      .list(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        if (
          items.some((connection) =>
            connection.models.some(
              (model) => !Array.isArray(model.supportedThinkingLevels)
            )
          )
        ) {
          throw new Error("模型后端未返回思考等级，请重启模型后端后重新读取。")
        }
        setModelLoading(false)
        setConnections(items)
        setModelLabels(
          Object.fromEntries(
            items.flatMap((connection) =>
              connection.models.map((model) => [
                modelSelectionId(connection, model),
                `${model.name} · ${connection.name}`,
              ])
            )
          )
        )
        setModelLoadError("")
      })
      .catch((error) => {
        if (!controller.signal.aborted) setModelLoading(false)
        if (!controller.signal.aborted)
          setModelLoadError(
            error instanceof Error ? error.message : "模型配置读取失败。"
          )
      })
    return () => controller.abort()
  }, [modelService, modelRefresh])

  useEffect(() => {
    const refresh = () => setModelRefresh((value) => value + 1)
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [])

  const settingsGuard = useRef<LeaveGuard | null>(null)
  const registerSettingsLeave = useCallback((guard: LeaveGuard | null) => {
    settingsGuard.current = guard
  }, [])
  function leaveSettings(action: () => void) {
    const leave = () => {
      setSettingsOpen(false)
      action()
    }
    if (settingsOpen && settingsGuard.current) settingsGuard.current(leave)
    else leave()
  }
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
  const [workspaces, setWorkspaces] = useState(() => [
    ...homeData.workspaces.map((workspace, index) =>
      index === 0 ? { ...workspace, name: "工作目录", path: "" } : workspace
    ),
    ...readHomeWorkspaces().filter(
      (workspace) =>
        !homeData.workspaces.some((item) => item.id === workspace.id)
    ),
  ])
  useEffect(() => {
    const controller = new AbortController()
    sessionService
      .catalog("", controller.signal)
      .then((catalog) => {
        if (controller.signal.aborted) return
        const cwd = catalog.cwd
        setWorkspaces((items) =>
          items.map((workspace, index) =>
            index === 0
              ? {
                  ...workspace,
                  path: cwd,
                  name: cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd,
                }
              : workspace
          )
        )
        setWorkspaceError("")
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setWorkspaceError(
            error instanceof Error ? error.message : String(error)
          )
      })
    return () => controller.abort()
  }, [sessionService, workspaceReload])
  const current = sessions.find((s) => s.id === selected)
  const data = {
    ...homeData,
    workspaces,
    models: connections
      .filter((connection) => !connectionIssue(connection))
      .flatMap((connection) =>
        connection.models.map((model) => modelSelectionId(connection, model))
      ),
    modelLabels,
    modelCatalog: {
      items: connections.flatMap((connection) =>
        connection.models.map((model) => ({
          value: modelSelectionId(connection, model),
          name: model.name,
          connection: connection.name,
          modelId: model.id,
        }))
      ),
      status: modelLoading
        ? ("loading" as const)
        : modelLoadError
          ? ("error" as const)
          : ("ready" as const),
      error: modelLoadError,
      onRetry: () => {
        setModelLoading(true)
        setModelLoadError("")
        setModelRefresh((value) => value + 1)
      },
      onOpenSettings: () => setSettingsOpen(true),
    },
    modelThinking: Object.fromEntries(
      connections.flatMap((connection) =>
        connection.models.map((model) => [
          modelSelectionId(connection, model),
          (model.supportedThinkingLevels ?? []).map(
            (level) => thinkingLabels[level]
          ),
        ])
      )
    ),
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
    <SessionServiceContext.Provider value={sessionService}>
      <AppShell
        data={data}
        activeConversationId={selected}
        onSettings={() => setSettingsOpen(true)}
        onSelectConversation={(item) =>
          leaveSettings(() => selectConversation(item.id))
        }
        onNew={(workspaceId) => {
          leaveSettings(() => {
            selectConversation(undefined)
            setHomeDraft((v) => ({ key: v.key + 1, workspaceId }))
          })
        }}
      >
        {workspaceError && (
          <div role="alert" className="px-4 py-2 text-sm text-destructive">
            工作目录读取失败：{workspaceError}{" "}
            <Button
              variant="link"
              size="sm"
              onClick={() => setWorkspaceReload((value) => value + 1)}
            >
              重新读取
            </Button>
          </div>
        )}
        {modelLoadError && (
          <p role="alert" className="px-4 py-2 text-sm text-destructive">
            模型配置读取失败：{modelLoadError}
          </p>
        )}
        {settingsOpen && (
          <Suspense
            fallback={
              <div role="status" className="p-8">
                正在打开设置…
              </div>
            }
          >
            <ModelSettingsPage
              service={modelService}
              onReturn={() => setSettingsOpen(false)}
              onConnectionsChange={(items) => {
                setModelLoadError("")
                setConnections(items)
                setModelLabels((previous) => ({
                  ...previous,
                  ...Object.fromEntries(
                    items.flatMap((connection) =>
                      connection.models.map((model) => [
                        modelSelectionId(connection, model),
                        `${model.name} · ${connection.name}`,
                      ])
                    )
                  ),
                }))
              }}
              registerLeave={registerSettingsLeave}
            />
          </Suspense>
        )}
        <div
          className={settingsOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}
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
                      dispatch({
                        type: "question-draft",
                        id: current.id,
                        draft,
                      })
                    }
                    onAnswer={(answers) =>
                      dispatch({ type: "answer", id: current.id, answers })
                    }
                    onCancel={() =>
                      dispatch({ type: "cancel", id: current.id })
                    }
                    onStop={() => dispatch({ type: "stop", id: current.id })}
                    stopping={current.phase === "stopping"}
                  />
                ) : undefined
              }
              composer={
                <ConversationComposer
                  sessionId={current.id}
                  key={current.id}
                  data={data}
                  draft={current.draft}
                  workspacePath={
                    workspaces.find((w) => w.id === current.workspaceId)
                      ?.path ?? current.workspaceId
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
                onSubmit={async (draft, signal) => {
                  const id = draft.sessionId ?? crypto.randomUUID()
                  const cwd =
                    workspaces.find(
                      (workspace) => workspace.id === draft.workspaceId
                    )?.path ?? ""
                  const saved = await sessionService.read(id, signal)
                  const configuration =
                    saved ??
                    (await sessionService.apply(
                      { sessionId: id, cwd, ...draft.session },
                      signal
                    ))
                  signal?.throwIfAborted()
                  if (configuration.unavailableToolIds.length) {
                    throw new Error(
                      "会话包含不可用工具，请在会话配置中取消这些工具后再发送。"
                    )
                  }
                  consumeHomeSession(
                    workspaces.find(
                      (workspace) => workspace.id === draft.workspaceId
                    )?.path ?? ""
                  )
                  dispatch({
                    type: "create",
                    id,
                    draft: {
                      ...draft,
                      session: {
                        toolIds: configuration.toolIds,
                        instructionScope: configuration.instructionScope,
                      },
                    },
                  })
                  setSelected(id)
                  return ""
                }}
              />
            </div>
          )}
        </div>
      </AppShell>
    </SessionServiceContext.Provider>
  )
}
