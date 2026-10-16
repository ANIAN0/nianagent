import { useEffect, useState } from "react"
import QRCode from "qrcode"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import type { PluginDescriptor } from "@/contracts/rpc.generated"
import fileManifest from "../../../backend/plugins/file-workbench/manifest.json"
import opencliManifest from "../../../backend/plugins/opencli/manifest.json"
import remoteManifest from "../../../backend/plugins/remote-access/manifest.json"
import { Page as FilePage } from "../../../backend/plugins/file-workbench/web"
import { OpenCliConnectionView } from "../../../backend/plugins/opencli/web"
import { exampleStatus } from "../../../backend/plugins/opencli/web.catalog"
import {
  RemoteConnectionView,
  UploadReservationsView,
} from "../../../backend/plugins/remote-access/web"
import { PluginSettings, type PluginManagementService } from "./plugin-settings"
import { SettingsShell } from "@/features/settings/settings-shell"
import { Button } from "@/components/ui/button"
import { pluginsChanged } from "./plugin-service"
import "./plugins.css"

function SettingsExample({
  failure = false,
  connected = true,
  externalChange = false,
  stopFailure = false,
  readFailure = false,
  badConfiguration = false,
  abandonedUpload = false,
}: {
  failure?: boolean
  connected?: boolean
  externalChange?: boolean
  stopFailure?: boolean
  readFailure?: boolean
  badConfiguration?: boolean
  abandonedUpload?: boolean
}) {
  const [event, setEvent] = useState("")
  const [qr, setQr] = useState("")
  const [uploadSlots, setUploadSlots] = useState(() =>
    abandonedUpload
      ? [
          {
            token: "example-transfer",
            version: "example-version",
            name: "中断的附件.png",
            bytes: 4096,
            offset: 2048,
            uncertain: true,
          },
        ]
      : []
  )
  const exampleUrl = "https://example.invalid/moon/#example"
  useEffect(() => {
    let active = true
    void QRCode.toDataURL(exampleUrl, { width: 240, margin: 2 })
      .then((data) => {
        if (active) setQr(data)
      })
      .catch(() => {
        if (active) setEvent("示例二维码生成失败。")
      })
    return () => {
      active = false
    }
  }, [])
  const [service] = useState<
    PluginManagementService & {
      simulateExternalChange: () => void
      restoreReading: () => void
    }
  >(() => {
    let externalRevision = 0
    let readingUnavailable = false
    let items: PluginDescriptor[] = [
      fileManifest,
      opencliManifest,
      remoteManifest,
    ].map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      source: `backend/plugins/${manifest.id}`,
      sourceKind: "bundled",
      installed: true,
      enabled: true,
      revision: 0,
      generation: 1,
      state: "active",
      businessState: "组件目录隔离状态",
      error: "",
      configuration:
        badConfiguration && manifest.id === "file-workbench"
          ? "{"
          : JSON.stringify(manifest.defaultConfiguration),
      configurationSchema: JSON.stringify(manifest.configurationSchema),
      contributions:
        manifest.contributions as PluginDescriptor["contributions"],
      tools: [],
    }))
    return {
      list: async () => {
        if (readingUnavailable) throw new Error("示例：状态服务暂不可用。")
        return structuredClone(items)
      },
      restoreReading: () => {
        readingUnavailable = false
        setEvent("隔离读取服务已恢复，请点击正式组件的重新读取。")
      },
      simulateExternalChange: () => {
        externalRevision++
        items = items.map((item) =>
          item.id === "file-workbench"
            ? {
                ...item,
                configuration: JSON.stringify({
                  editorPath: `另一处保存的新配置 ${externalRevision}`,
                }),
                revision: item.revision + 1,
              }
            : item
        )
        pluginsChanged()
        setEvent(
          "仅隔离服务的已保存配置变化，正式组件应保留本地草稿并提示冲突。"
        )
      },
      configure: async (input) => {
        if (failure) throw new Error("示例：当前执行或审批结束后才能更改插件。")
        const current = items.find((item) => item.id === input.id)
        if (!current || current.revision !== input.revision)
          throw new Error("示例版本已变化，请重新读取。")
        if (stopFailure && !input.enabled) {
          items = items.map((item) =>
            item.id === input.id
              ? {
                  ...item,
                  generation: item.generation + 1,
                  state: "failed",
                  error: "示例：资源释放尚未确认。",
                }
              : item
          )
          readingUnavailable = readFailure
          setEvent(
            "隔离服务释放失败，启用配置与revision保持原值；正式组件须读取真实失败状态并保留草稿。"
          )
          throw new Error("示例：停用时资源释放失败。")
        }
        items = items.map((item) =>
          item.id === input.id
            ? {
                ...item,
                enabled: input.enabled,
                configuration: input.configuration,
                revision: item.revision + 1,
                generation: item.generation + 1,
                state: input.enabled ? "active" : "disabled",
              }
            : item
        )
        setEvent(`候选已在预览内更新：${current.name}`)
      },
      add: async (source) => {
        const sourceKind = source.startsWith("npm:")
          ? "npm"
          : source.startsWith("git:")
            ? "git"
            : "local"
        items = [
          ...items,
          {
            ...items[0],
            id: crypto.randomUUID(),
            name: source,
            source,
            sourceKind,
            installed: sourceKind === "local",
            enabled: false,
            state: "disabled",
            revision: 0,
            configuration: "{}",
            configurationSchema:
              '{"type":"object","properties":{},"additionalProperties":false}',
            contributions: [],
            tools: [],
          },
        ]
        setEvent("只在预览内登记来源，未读取文件或安装程序。")
      },
      package: async (id, action) => {
        items =
          action === "remove"
            ? items.filter((item) => item.id !== id)
            : items.map((item) =>
                item.id === id
                  ? { ...item, installed: true, revision: item.revision + 1 }
                  : item
              )
        setEvent(`只在预览内触发${action}，未安装或删除真实来源。`)
      },
    }
  })
  return (
    <>
      {externalChange && (
        <div className="p-6">
          <Button variant="outline" onClick={service.simulateExternalChange}>
            模拟另一处保存配置
          </Button>
        </div>
      )}
      {stopFailure && readFailure && (
        <div className="p-6">
          <Button variant="outline" onClick={service.restoreReading}>
            恢复隔离状态读取
          </Button>
        </div>
      )}
      <PluginSettings
        service={service}
        renderPage={(plugin) =>
          plugin.id === "file-workbench" ? (
            <FilePage pluginId={plugin.id} />
          ) : plugin.id === "opencli" ? (
            <OpenCliConnectionView
              value={exampleStatus(connected)}
              error=""
              onRead={() => setEvent("预览触发状态读取，未启动后台。")}
              onAction={(action) =>
                setEvent(`预览触发${action}，未管理真实全局软件。`)
              }
            />
          ) : (
            <div className="flex flex-col gap-6">
              <RemoteConnectionView
                status={{
                  online: connected,
                  clients: 0,
                  issue: connected
                    ? "组件目录示例连接"
                    : "示例：远程连接离线。",
                  url: exampleUrl,
                }}
                qr={qr}
                error=""
                busy={false}
                onCopy={() => setEvent("预览触发复制链接，未修改系统剪贴板。 ")}
                onReset={() => setEvent("预览触发整体重置，未修改真实连接。 ")}
              />
              <UploadReservationsView
                items={uploadSlots}
                more={false}
                busy={false}
                issue=""
                onRefresh={() => setEvent("仅读取隔离接收记录。")}
                onCancel={(item) => {
                  setUploadSlots((items) =>
                    items.filter((value) => value.token !== item.token)
                  )
                  setEvent("示例接收占位已取消，示例副本保留；未访问真实上传。")
                }}
              />
            </div>
          )
        }
      />
      <p className="p-6 text-sm text-muted-foreground" role="status">
        {event || "此预览使用正式组件与隔离内存服务。"}
      </p>
    </>
  )
}

function SettingsWorkspaceExample() {
  return (
    <div className="h-dvh min-h-0 overflow-hidden">
      <SettingsShell section="plugins" onSelect={() => {}} onReturn={() => {}}>
        <SettingsExample />
      </SettingsShell>
    </div>
  )
}

export default {
  id: "plugin-settings",
  name: "插件设置完整组合",
  source: "src/features/plugins/plugin-settings.tsx",
  group: "插件设置",
  layer: "复合组件",
  order: 179,
  pages: ["设置"],
  stage: "content",
  description:
    "完整正式PluginSettings、配置schema字段、来源管理及文件/OpenCLI/远程业务内容组合。",
  boundary:
    "manifest与正式组件直接复用；管理和业务回调限预览内存，不访问用户文件、修改全局配置、启动后台或连接真实远程。示例状态不证明实际宿主验收。",
  story: {
    goal: "在完整插件组合中管理来源、启停和配置，并阅读各插件的业务状态。",
    preconditions: ["正式组件、manifest和隔离预览服务就绪。"],
    result:
      "动作后读取真实状态；失败说明与读取失败分别保留，草稿不丢；连接状态与启用状态分别可读。",
  },
  standards: [
    {
      id: "P1",
      name: "真实值与来源",
      rule: "启用、安装、版本、加载及业务状态分别展示；来源保持可读。",
      reason: "安装或启用不是连接成功。",
      check: "核对源版本与实际manifest，启停其他插件不联动。",
    },
    {
      id: "P2",
      name: "保存与失败",
      rule: "共享schema字段验证候选；动作成功或失败后均读取真实状态，读取失败另行提示当前显示未确认，保留动作错误与草稿。",
      reason: "候选不应冒充已生效。",
      check:
        "正常保存，再从启用状态实际停用失败；核对原启用值、failed反馈、草稿及动作错误。读取也失败时恢复读取并重新读取。",
    },
    {
      id: "P4",
      name: "配置草稿与冲突",
      rule: "启停只保存已保存配置；重读及启停保留草稿。外部配置变化须明确采用或确认覆盖，保存按当前revision核对。",
      reason: "启用状态更新不应静默丢弃编辑，也不能默默覆盖另一处保存的值。",
      check:
        "修改字段后启停/重读仍保留；触发另一处保存后核对草稿、保存门禁与两个明确处理入口。",
    },
    {
      id: "P3",
      name: "设置长页可达",
      rule: "正式设置壳保持标题和分区导航，插件长内容在有界内容区滚动；底部操作可到达。",
      reason: "工作台裁切溢出内容时，自然高度插件页仍需要真实滚动入口。",
      check: "在完整设置壳中向下滚动到远程插件底部，再回到页首；不执行重置。",
    },
  ],
  inputs: [
    "PluginManagementService沿原pluginList/configure/import/package接口",
    "renderPage由同一正式网页贡献负责业务组合",
  ],
  events: [
    "启停/配置后读取权威值",
    "导入、安装与启用分别表达",
    "各插件业务动作由其owner处理",
  ],
  composition: [
    "SettingsShell / 有界设置内容区",
    "PluginSettings / Field / Switch / Input / Button / ExtensionConfigurationFields",
    "文件Page / OpenCliConnectionView / RemoteConnectionView / QRCode",
  ],
  consumers: ["正式SettingsPage插件分区"],
  states: [
    {
      id: "bad-configuration",
      name: "单插件配置损坏",
      section: "exception",
      condition: "文件插件的隔离已保存配置不是有效JSON，其他插件保持正常。",
      steps: ["读取插件页，核对损坏行说明。", "停用该行，再管理其他插件。"],
      expected: "坏配置原文保持，插件页不崩溃，其他插件可继续管理。",
      render: () => <SettingsExample badConfiguration />,
    },
    {
      id: "abandoned-upload",
      name: "取消中断上传的接收占位",
      section: "exception",
      condition: "远程插件展示准备结果待核对的隔离接收项。",
      steps: ["滚动到未完成上传。", "取消接收并保留副本，再重新读取。"],
      expected: "移出接收列表，明确原副本保留；不删除或重置真实远程连接。",
      render: () => <SettingsExample abandonedUpload />,
    },
    {
      id: "stop-failure",
      name: "停用释放失败后读取真实状态",
      section: "exception",
      condition:
        "隔离服务从已启用起点尝试释放资源，释放失败后保持原配置和revision。",
      steps: [
        "在文件插件输入未保存草稿，关闭启用开关。",
        "核对开关保持启用、失败状态、释放未确认说明及原动作错误。",
        "重新读取，核对草稿仍在且不显示为已停用成功。",
      ],
      expected:
        "正式组件读取后台failed描述符，启用配置保持原值，保留动作错误与未保存草稿；无真实资源副作用。",
      render: () => <SettingsExample stopFailure />,
    },
    {
      id: "stop-failure-read-unavailable",
      name: "停用失败且状态暂不可读",
      section: "exception",
      condition: "隔离服务停用释放失败后，描述符读取也暂不可用。",
      steps: [
        "输入未保存草稿并关闭文件插件开关。",
        "核对原动作错误及状态读取失败两类反馈，显示值标明可能不是最新状态。",
        "恢复隔离状态读取，再点击正式重新读取，核对failed状态、原启用值与原草稿。",
      ],
      expected: "未知读取不假称已停用；恢复后读回真实失败状态且草稿保持。",
      render: () => <SettingsExample stopFailure readFailure />,
    },
    {
      id: "configuration-conflict",
      name: "配置草稿与外部保存冲突",
      section: "exception",
      condition: "正式PluginSettings与隔离服务；先输入草稿，再触发另一处保存。",
      steps: [
        "在文件插件输入草稿，启停并重新读取，核对原草稿和开关。",
        "点击模拟另一处保存配置，保存应阻止，原草稿仍可编辑。",
        "分别核对采用已保存配置和保留草稿并确认覆盖后的显式保存。",
      ],
      expected:
        "真实组件保留未保存稿，启停不偷偷保存，外部变更有可操作的冲突处理；仅隔离服务变化。",
      render: () => <SettingsExample externalChange />,
    },
    {
      id: "scroll-workspace",
      name: "完整设置壳长页滚动",
      section: "states",
      condition:
        "正式SettingsShell包裹原插件隔离组合，导航固定在插件分区，仅核对布局。",
      steps: [
        "从插件页首滚动到远程访问的底部按钮，再返回页首。",
        "将视口缩至窄窗，核对标题、分区导航和内容滚动区。",
      ],
      expected:
        "长内容与底部操作可达，标题和导航保留；不执行重置或写入正式配置。",
      render: () => <SettingsWorkspaceExample />,
    },
    {
      id: "settings",
      name: "独立启停与来源",
      section: "normal",
      condition: "三个正式manifest与隔离状态就绪。",
      steps: [
        "停用再启用单个插件。",
        "修改配置并保存。",
        "添加一个来源并移除。",
      ],
      expected:
        "仅所属插件及预览候选变化，原组件组合完整，没有真实后台副作用。",
      render: () => <SettingsExample />,
    },
    {
      id: "failure",
      name: "变更被拒绝",
      section: "exception",
      condition: "隔离服务明确拒绝配置变更。",
      steps: ["切换任一插件开关。", "读取原位说明和开关值。"],
      expected: "不假称变更成功；原值保留。",
      render: () => <SettingsExample failure />,
    },
    {
      id: "disconnected",
      name: "启用但未连接",
      section: "states",
      condition: "插件已启用，浏览器和远程业务连接尚未就绪。",
      steps: ["查看启用开关与各业务连接说明。", "触发刷新或连接回调。"],
      expected: "启用不显示为业务已连接；动作仅回传预览事件。",
      render: () => <SettingsExample connected={false} />,
    },
  ],
  viewport: { width: 1100, height: 820 },
} satisfies CatalogEntry
