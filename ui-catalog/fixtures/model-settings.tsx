import { PiAuthorization } from "@/features/models/pi-authorization"
import { CredentialFields } from "@/features/models/credential-fields"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/features/home/app-shell"
import { ModelSettingsPage } from "@/features/models/model-settings-page"
import { ConnectionEditor } from "@/features/models/connection-editor"
import { ConnectionFields } from "@/features/models/connection-fields"
import { ModelEditor } from "@/features/models/model-editor"
import {
  ModelDirectory,
  DiscoveredModels,
} from "@/features/models/model-directory"
import { SubscriptionAuthorization } from "@/features/models/subscription-authorization"
import {
  createMockModelService,
  connectionFixtures,
  modelFixtures,
  type MockModelOptions,
} from "@/features/models/mock-model-service"
import {
  blankConnection,
  blankModel,
  type ModelConnection,
} from "@/features/models/model-types"
import { homeData } from "./home"
import "@/features/models/model-settings.css"

export function SettingsPageExample({
  empty = false,
  many = false,
  failure,
}: {
  empty?: boolean
  many?: boolean
  failure?: MockModelOptions["failure"]
}) {
  const [service] = useState(() =>
    createMockModelService(
      empty
        ? []
        : many
          ? Array.from({ length: 24 }, (_, index) => ({
              ...connectionFixtures[0],
              id: `demo-${index}`,
              name: `模型服务 ${index + 1}`,
            }))
          : connectionFixtures,
      { failure }
    )
  )
  const [open, setOpen] = useState(true)
  return (
    <AppShell
      data={homeData}
      onSettings={() => setOpen(true)}
      onNew={() => setOpen(false)}
      onSelectConversation={() => setOpen(false)}
    >
      {open ? (
        <ModelSettingsPage service={service} onReturn={() => setOpen(false)} />
      ) : (
        <div className="p-8">
          <Button onClick={() => setOpen(true)}>打开模型设置</Button>
        </div>
      )}
    </AppShell>
  )
}
export function ConnectionEditorExample({
  kind = "saved",
  failure,
}: {
  kind?: "saved" | "new" | "environment" | "subscription"
  failure?: MockModelOptions["failure"]
}) {
  const [service] = useState(() =>
    createMockModelService(connectionFixtures, { failure })
  )
  const [initial, setInitial] = useState<ModelConnection>(() =>
    kind === "new"
      ? blankConnection("api")
      : connectionFixtures[
          kind === "subscription" ? 4 : kind === "environment" ? 5 : 0
        ]
  )
  const [notice, setNotice] = useState("")
  return (
    <div className="model-settings-content h-dvh bg-card">
      <ConnectionEditor
        key={JSON.stringify(initial)}
        initial={initial}
        connections={connectionFixtures}
        service={service}
        onSaved={(value) => {
          setInitial(value)
          setNotice("已保存连接，密钥原文已清除。")
        }}
        onClose={() => setNotice("已返回连接目录。")}
      />
      {notice && (
        <div
          role="status"
          className="fixed right-4 bottom-20 rounded-lg border bg-popover p-3"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
export function ConnectionFieldsExample({
  mode = "key",
  invalid = false,
  credentialOnly = false,
}: {
  mode?: ModelConnection["credential"]
  invalid?: boolean
  credentialOnly?: boolean
}) {
  const [value, setValue] = useState<ModelConnection>({
    ...connectionFixtures[0],
    credential: mode,
    keySaved: !invalid,
    environmentVariable: mode === "environment" ? "DEMO_API_KEY" : "",
  })
  const props = {
    value,
    errors: invalid
      ? {
          name: "请输入连接名称。",
          credential: "请输入 API 密钥。",
          headers: "请输入键和值均为字符串的 JSON 对象。",
        }
      : ({} as Record<string, string>),
    onChange: (patch: Partial<ModelConnection>) =>
      setValue((v) => ({ ...v, ...patch })),
    onClearKey: (apply: () => void) => apply(),
  }
  return (
    <div className="model-page">
      {credentialOnly ? (
        <CredentialFields
          {...props}
          onRevealKey={async () => "moon-demo-key-not-a-real-secret"}
        />
      ) : (
        <ConnectionFields
          onRevealKey={async () => "moon-demo-key-not-a-real-secret"}
          {...props}
        />
      )}
    </div>
  )
}
export function ModelEditorExample({ edit = false }: { edit?: boolean }) {
  const [open, setOpen] = useState(true)
  const [notice, setNotice] = useState("")
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>打开模型编辑</Button>
      <p role="status">{notice}</p>
      {open && (
        <ModelEditor
          initial={edit ? modelFixtures[0] : blankModel()}
          originalId={edit ? modelFixtures[0].id : undefined}
          existing={modelFixtures}
          connectionName="OpenAI"
          onClose={() => setOpen(false)}
          onSave={(model) => {
            setNotice(`已加入草稿：${model.name}`)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
export function ModelDirectoryExample({
  empty = false,
  candidates = false,
  failed = false,
}: {
  empty?: boolean
  candidates?: boolean
  failed?: boolean
}) {
  const [models, setModels] = useState(empty ? [] : modelFixtures)
  const [selected, setSelected] = useState<(typeof modelFixtures)[number]>()
  const [checks, setChecks] = useState<
    Record<string, { error?: boolean; text: string }>
  >({})
  return (
    <div className="model-page flex flex-col gap-4">
      {candidates ? (
        <DiscoveredModels
          models={modelFixtures.map((model, index) => ({
            ...model,
            contextWindow: index >= 1 ? undefined : model.contextWindow,
            maxTokens: index > 1 ? undefined : model.maxTokens,
            reasoning: index > 1 ? undefined : model.reasoning,
            metadata: {
              status:
                index === 0 ? "matched" : index === 1 ? "partial" : "unknown",
              sources: index < 2 ? ["Pi / 示例目录"] : [],
              conflicts: index === 1 ? ["contextWindow"] : [],
            },
          }))}
          existing={models.slice(0, 1)}
          onAdd={(items) => setModels((values) => [...values, ...items])}
        />
      ) : (
        <ModelDirectory
          models={models}
          checks={checks}
          onEdit={setSelected}
          onRemove={(model) =>
            setModels((values) =>
              values.filter((value) => value.id !== model.id)
            )
          }
          onCheck={(model) =>
            setChecks((values) => ({
              ...values,
              [model.id]: {
                error: failed,
                text: failed
                  ? "不可用 · 模拟服务超时，模型已保留。"
                  : "可用 · 模拟检查通过",
              },
            }))
          }
        />
      )}{" "}
      {selected && (
        <ModelEditor
          initial={selected}
          originalId={selected.id}
          existing={models}
          connectionName="OpenAI"
          onClose={() => setSelected(undefined)}
          onSave={(model) => {
            setModels((values) =>
              values.map((value) => (value.id === selected.id ? model : value))
            )
            setSelected(undefined)
          }}
        />
      )}
    </div>
  )
}
export function AuthorizationExample({
  expired = false,
  failed = false,
}: {
  expired?: boolean
  failed?: boolean
}) {
  const [service] = useState(() =>
    createMockModelService(connectionFixtures, {
      failure: failed ? "authorize" : undefined,
      oauthDelay: expired ? 6000 : 2200,
    })
  )
  const [open, setOpen] = useState(true)
  const [notice, setNotice] = useState("")
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>重新授权</Button>
      <p role="status">{notice}</p>
      {open && (
        <SubscriptionAuthorization
          name="订阅账号"
          service={service}
          expiresAfter={expired ? 2 : 180}
          onClose={() => setOpen(false)}
          onComplete={(account) => {
            setNotice(`已授权：${account.name}`)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function PiAuthorizationExample() {
  const [done, setDone] = useState(false)
  const [service] = useState(() => {
    const connection = {
      ...connectionFixtures[4],
      providerId: "example",
      revision: 1,
    }
    let current: import("@/features/models/model-types").AuthState = {
      id: "catalog-only",
      status: "pending",
      connection,
      events: [
        {
          type: "device_code",
          userCode: "DEMO-1234",
          verificationUri: "https://example.invalid",
        },
      ],
      prompt: {
        id: "prompt",
        type: "manual_code",
        message: "填写服务返回的授权码",
      },
    }
    return {
      ...createMockModelService([connection]),
      auth: {
        start: async () => current,
        poll: async () => current,
        reply: async () => {
          current = {
            ...current,
            status: "complete",
            connection: {
              ...connection,
              account: { name: "示例账号", plan: "演示", loggedIn: true },
            },
          }
          return current
        },
        cancel: async () => {},
        logout: async () => connection,
      },
    }
  })
  return done ? (
    <Button onClick={() => setDone(false)}>重新打开授权演示</Button>
  ) : (
    <PiAuthorization
      connection={connectionFixtures[4]}
      service={service}
      onComplete={() => setDone(true)}
      onClose={() => setDone(true)}
    />
  )
}
