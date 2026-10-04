import type { ModelCheckState } from "@/features/models/use-connection-editor"
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
import { createMcpFixtureService } from "./mcp"

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
  const [mcpService] = useState(createMcpFixtureService)
  return (
    <AppShell
      data={homeData}
      onSettings={() => setOpen(true)}
      onNew={() => setOpen(false)}
      onSelectConversation={() => setOpen(false)}
    >
      {open ? (
        <ModelSettingsPage
          service={service}
          mcpService={mcpService}
          onReturn={() => setOpen(false)}
        />
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
  kind?:
    "saved" | "new" | "environment" | "subscription" | "subscription-active"
  failure?: MockModelOptions["failure"]
}) {
  const subscription = kind === "subscription" || kind === "subscription-active"
  const fixtures = connectionFixtures.map((item) =>
    item.kind === "subscription" && kind === "subscription-active"
      ? {
          ...item,
          providerId: "example",
          account: { ...item.account!, loggedIn: true },
        }
      : item
  )
  const [service] = useState(() =>
    createMockModelService(fixtures, { failure })
  )
  const [initial, setInitial] = useState<ModelConnection>(() =>
    kind === "new"
      ? blankConnection("api")
      : {
          ...fixtures[subscription ? 4 : kind === "environment" ? 5 : 0],
          revision: 1,
          ...(subscription ? { providerId: "example" } : {}),
        }
  )
  const [notice, setNotice] = useState("")
  const [open, setOpen] = useState(true)
  return (
    <div className="model-settings-content h-dvh bg-card">
      {open ? (
        <ConnectionEditor
          key={initial.id}
          initial={initial}
          connections={fixtures.map((item) => ({
            ...item,
            revision: item.revision ?? 1,
          }))}
          service={service}
          onSaved={(value) => {
            setInitial(value)
            setNotice("已保存连接，密钥原文已清除。")
            setOpen(false)
          }}
          onAccountSaved={setInitial}
          onClose={() => {
            setNotice("已返回连接目录。")
            setOpen(false)
          }}
        />
      ) : (
        <div className="model-page">
          <Button
            onClick={() => {
              setNotice("")
              setOpen(true)
            }}
          >
            重新打开连接配置
          </Button>
        </div>
      )}
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
  unknown = false,
}: {
  empty?: boolean
  candidates?: boolean
  failed?: boolean
  unknown?: boolean
}) {
  const [models, setModels] = useState(empty ? [] : modelFixtures)
  const [selected, setSelected] = useState<(typeof modelFixtures)[number]>()
  const [checks, setChecks] = useState<Record<string, ModelCheckState>>({})
  const [notice, setNotice] = useState("")
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
          onConfigureConnection={() =>
            setNotice(
              "已请求编辑连接凭据；本示例只记录该受控事件，不读取真实配置。"
            )
          }
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
                error: failed || unknown,
                text:
                  failed || unknown
                    ? "示例模型检查未完成"
                    : "示例检查通过 · 未调用真实模型",
                issue: unknown
                  ? {
                      code: "result_unknown",
                      severity: "warning",
                      recovery: "none",
                      message:
                        "示例：未收到推理结果，请求可能已完成。发起新检查会创建另一次推理请求。",
                    }
                  : failed
                    ? {
                        code: "check_failed",
                        severity: "error",
                        recovery: "settings",
                        message: "示例：连接凭据失效，请检查连接配置。",
                      }
                    : undefined,
              },
            }))
          }
        />
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
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

export function PiAuthorizationExample({
  failure,
  slow = false,
}: {
  failure?: MockModelOptions["failure"]
  slow?: boolean
}) {
  const [connection, setConnection] = useState<ModelConnection>({
    ...connectionFixtures[4],
    providerId: "example",
    revision: 1,
  })
  const [service] = useState(() =>
    createMockModelService([connection], {
      failure,
      oauthDelay: slow ? 2400 : 450,
    })
  )
  const [open, setOpen] = useState(true)
  const [notice, setNotice] = useState("")
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>重新打开授权演示</Button>
      <p role="status" className="mt-3 text-sm text-muted-foreground">
        {notice}
      </p>
      {open && (
        <PiAuthorization
          connection={connection}
          service={service}
          onComplete={(saved) => {
            setConnection(saved)
            setNotice("示例账号授权完成；未连接真实账号。")
            setOpen(false)
          }}
          onCancelled={(saved) => {
            setConnection(saved)
            setNotice("原示例授权已结束，连接以服务的保存状态为准。")
            setOpen(false)
          }}
          onClose={() => {
            setNotice("原示例授权已结束。")
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
