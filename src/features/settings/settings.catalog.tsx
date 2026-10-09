import type { McpService } from "@/features/mcp/mcp-service"
import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import type {
  DesktopCommand,
  DesktopRequests,
  DesktopResults,
  DesktopSnapshot,
  MigrationPlan,
} from "@/contracts/desktop.generated"
import type { ModelService } from "@/features/models/model-types"
import {
  DesktopCommandError,
  DesktopServiceProvider,
  type DesktopService,
  type DesktopView,
  unavailableDesktopIssue,
} from "./desktop-service"
import { SettingsPage } from "./settings-page"
import { MaintenanceStatus } from "./maintenance-status"
import type { SettingsSection } from "./settings-shell"

type Scenario = "storage" | "updates" | "retained" | "unavailable" | "failure"
function previewService(scenario: Scenario): DesktopService {
  const emptyMaintenance: DesktopSnapshot["maintenance"] = {
    operationId: null,
    revision: 0,
    kind: "none",
    phase: "idle",
    shutdownStarted: false,
    writesFrozen: false,
    sourceDirectory: null,
    targetDirectory: null,
    completedFiles: 0,
    totalFiles: 0,
    issue: null,
  }
  let snapshot: DesktopSnapshot = {
    revision: 1,
    version: "0.1.0",
    platform: "windows",
    architecture: "x86_64",
    development: false,
    storage: {
      dataDirectory: "D:/Apps/Moon/data",
      installDirectory: "D:/Apps/Moon",
      source: "installation",
      dataSetId: "catalog-only",
      generation: 1,
      schemaVersion: 1,
      directoryMappings: [],
      usedBytes: 1024 ** 2 * 128,
      availableBytes: 1024 ** 3 * 32,
      legacyCopyRetained: scenario === "retained",
      retainedCopyDirectories:
        scenario === "retained" ? ["D:/Previous/Moon/data"] : [],
    },
    capabilities: {
      migrateData: true,
      openDataDirectory: true,
      checkUpdates: true,
      installUpdates: true,
      unavailableReason: null,
    },
    maintenance: emptyMaintenance,
    update: {
      operationId: null,
      revision: 0,
      phase: "idle",
      release: null,
      downloadedBytes: 0,
      totalBytes: null,
      checkedAt: null,
      issue: null,
    },
    updatePreferences: { autoCheck: true, autoDownload: false },
  }
  let view: DesktopView =
    scenario === "unavailable"
      ? { snapshot: null, issue: unavailableDesktopIssue, listening: false }
      : { snapshot, issue: null, listening: true }
  const listeners = new Set<() => void>()
  const publish = () => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1 }
    view = { ...view, snapshot }
    for (const listener of listeners) listener()
  }
  async function call<K extends DesktopCommand>(
    command: K,
    input: DesktopRequests[K]
  ): Promise<DesktopResults[K]> {
    let result: unknown = null
    if (command === "desktop_choose_data_directory") result = "E:/MoonData"
    else if (command === "storage_prepare_migration") {
      if (scenario === "failure")
        throw new DesktopCommandError({
          code: "validation",
          message: "此目录已有文件，请选择新建或空的专用目录。",
          recovery: "chooseDirectory",
          activities: [],
        })
      result = {
        planId: "catalog-plan",
        sourceDirectory: snapshot.storage.dataDirectory,
        targetDirectory: (input as DesktopRequests["storage_prepare_migration"])
          .targetDirectory,
        dataSetId: snapshot.storage.dataSetId,
        generation: snapshot.storage.generation,
        fileCount: 248,
        totalBytes: snapshot.storage.usedBytes,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        activities: [],
      } satisfies MigrationPlan
    } else if (command === "storage_start_migration") {
      snapshot = {
        ...snapshot,
        maintenance: {
          ...emptyMaintenance,
          operationId: "catalog-maintenance",
          kind: "migration",
          phase: "copying",
          writesFrozen: true,
          shutdownStarted: true,
          completedFiles: 50,
          totalFiles: 248,
        },
      }
      result = snapshot.maintenance
    } else if (command === "update_check") {
      snapshot = {
        ...snapshot,
        update: {
          ...snapshot.update,
          phase: "available",
          checkedAt: new Date().toISOString(),
          release: {
            releaseId: "catalog-release",
            version: "0.2.0",
            notes:
              "新增数据目录迁移与版本更新。\n此处仅展示组件交互，不连接真实发行源。",
            publishedAt: new Date().toISOString(),
          },
        },
      }
      result = snapshot.update
    } else if (command === "update_download") {
      snapshot = {
        ...snapshot,
        update: {
          ...snapshot.update,
          phase: "ready",
          downloadedBytes: 1024 ** 2 * 64,
          totalBytes: 1024 ** 2 * 64,
        },
      }
      result = snapshot.update
    } else if (command === "update_install") {
      snapshot = {
        ...snapshot,
        maintenance: {
          ...emptyMaintenance,
          operationId: "catalog-install",
          kind: "update",
          phase: "flushing",
          writesFrozen: true,
        },
      }
      result = snapshot.maintenance
    } else if (command === "update_set_preferences") {
      snapshot = {
        ...snapshot,
        updatePreferences: input as DesktopRequests["update_set_preferences"],
      }
      result = snapshot.updatePreferences
    } else if (command === "desktop_get_state") result = snapshot
    publish()
    return result as DesktopResults[K]
  }
  return {
    getSnapshot: () => view,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start: () => () => {},
    refresh: async () => {},
    call,
  }
}
function SettingsExample({ scenario }: { scenario: Scenario }) {
  const [service] = useState(() => previewService(scenario))
  const [modelService] = useState<ModelService>(() => {
    const unavailable = async (): Promise<never> => {
      throw new Error("此隔离示例未连接模型服务。")
    }
    return {
      evidence: "demo",
      list: async () => [],
      save: unavailable,
      remove: unavailable,
      discover: unavailable,
      check: unavailable,
      auth: {
        start: unavailable,
        poll: unavailable,
        reply: unavailable,
        cancel: unavailable,
        logout: unavailable,
      },
    }
  })
  const [mcpService] = useState<McpService>(() => {
    const unavailable = async (): Promise<never> => {
      throw new Error("此隔离示例未连接 MCP 服务。")
    }
    return {
      evidence: "demo",
      list: async () => [],
      save: unavailable,
      remove: unavailable,
      test: unavailable,
    }
  })
  const section: SettingsSection =
    scenario === "updates" ? "updates" : "storage"
  return (
    <DesktopServiceProvider value={service}>
      <div className="flex h-full min-h-0 flex-col">
        <MaintenanceStatus />
        <div className="min-h-0 flex-1">
          <SettingsPage
            service={modelService}
            mcpService={mcpService}
            initialSection={section}
            onReturn={() => {}}
          />
        </div>
      </div>
    </DesktopServiceProvider>
  )
}
export default {
  id: "application-settings",
  name: "应用设置与维护",
  source: "src/features/settings/settings-page.tsx",
  layer: "页面",
  group: "设置",
  stage: "content",
  order: 240,
  pages: ["设置"],
  description: "正式设置壳复用模型/MCP编辑，并组合数据迁移与版本更新。",
  boundary:
    "直接使用SettingsPage、StorageSettings、UpdateSettings，原生服务只在预览内存替换；不访问真实磁盘、GitHub、配置恢复存储或安装器。预览通过不能证明原生维护通过。",
  inputs: [
    "SettingsPage: model/MCP服务、初始分区、返回/离开守卫；DesktopServiceProvider注入宿主状态与命令",
  ],
  events: [
    "分区导航沿原编辑leave guard；迁移先预检再确认，安装必须明确确认；真实App全局负责flush",
  ],
  composition: [
    "SettingsShell / ModelSettingsContent / StorageSettings / UpdateSettings / MaintenanceStatus / DesktopFeedback / Dialog / Button / Checkbox / Switch",
  ],
  consumers: ["App完整设置入口"],
  standards: [
    {
      id: "settings-task",
      name: "完整设置任务",
      rule: "目录来源、复制范围、旧副本、版本状态与安装确认在各自页面完整呈现。窄窗四个分区可读、当前分区可见。",
      reason: "保证用户知道当前数据位置和操作结束结果，避免把下载当安装。",
      check:
        "从正式首页进入；组件页操作迁移预检、更新检查下载和稍后安装，在357px/800px及深浅主题核对。",
    },
  ],
  states: [
    {
      id: "storage",
      name: "目录迁移完整流程",
      section: "normal",
      condition: "当前安装目录数据，服务在预览内存。",
      steps: ["选择目录并预检。", "检查源、目标和规模，稍后迁移或明确确认。"],
      expected: "确认前不变更数据，原副本保留说明明确。",
      render: () => <SettingsExample scenario="storage" />,
    },
    {
      id: "updates",
      name: "检查、下载与确认安装",
      section: "normal",
      condition: "尚未检查；预览提供确定的发行信息。",
      steps: [
        "检查更新，查看版本说明。",
        "下载并验证，打开安装确认再选择稍后安装。",
      ],
      expected: "下载完成与安装分开，退出后需重新下载的限制可见。",
      render: () => <SettingsExample scenario="updates" />,
    },
    {
      id: "retained",
      name: "新目录与保留副本",
      section: "states",
      condition: "已启用新根，记录中存在旧副本。",
      steps: ["读取当前目录、大小和旧副本。"],
      expected: "只有打开旧副本入口，不提供默认恢复或覆盖旧副本。",
      render: () => <SettingsExample scenario="retained" />,
    },
    {
      id: "unavailable",
      name: "浏览器原生不可用",
      section: "exception",
      condition: "普通浏览器缺少Tauri。",
      steps: ["切换数据与更新分区。"],
      expected: "明确真实环境限制，不伪造目录或成功。",
      render: () => <SettingsExample scenario="unavailable" />,
    },
    {
      id: "failure",
      name: "非空目录拒绝",
      section: "exception",
      condition: "预览服务拒绝非空目标。",
      steps: ["选择目录，发起预检。"],
      expected: "保留当前根和输入，指出需选择空目录。",
      render: () => <SettingsExample scenario="failure" />,
    },
  ],
  viewport: { width: 960, height: 700 },
} satisfies CatalogEntry
