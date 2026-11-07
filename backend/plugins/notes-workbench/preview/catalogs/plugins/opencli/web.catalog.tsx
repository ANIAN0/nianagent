import { useState } from "react"
import type { CatalogEntry } from "../../catalog-types.ts"
import { Page } from "../../../../../opencli/web"
import type {
  OpenCliService,
  OpenCliStatus,
} from "../../../../../opencli/types"

export function exampleStatus(connected = true): OpenCliStatus {
  return {
    installation: {
      state: "installed",
      version: "示例当前版本",
      path: "C:/示例用户/npm/node_modules/@jackwener/opencli",
      cliPath: "C:/示例用户/npm/node_modules/@jackwener/opencli/dist/main.js",
      daemonPath:
        "C:/示例用户/npm/node_modules/@jackwener/opencli/dist/daemon.js",
      license: "Apache-2.0",
      npmPath: "C:/示例用户/npm/npm.cmd",
      nodePath: "C:/示例用户/node.exe",
      usable: true,
      issue: "",
      latestVersion: "示例目标版本",
      latestIssue: "",
    },
    daemon: {
      state: "running",
      pid: 12345,
      version: "示例当前版本",
      owned: false,
    },
    bridge: {
      connected,
      profileRequired: false,
      profiles: connected
        ? [
            {
              contextId: "示例连接",
              extensionVersion: "示例扩展版本",
              aliases: ["工作浏览器"],
            },
          ]
        : [],
    },
    operation: null,
    browserSupport: null,
    version: "示例当前版本",
    status: {},
    issue: "组件目录隔离状态，不读取真实安装。",
  }
}

function Example({
  missing = false,
  offline = false,
  fail = false,
  unknown = false,
}: {
  missing?: boolean
  offline?: boolean
  fail?: boolean
  unknown?: boolean
}) {
  const [source] = useState<OpenCliService>(() => {
    const value = exampleStatus(!offline)
    if (missing) {
      Object.assign(value.installation, {
        state: "not-installed",
        version: null,
        path: null,
        cliPath: null,
        daemonPath: null,
        usable: false,
      })
      value.daemon = {
        state: "stopped",
        pid: null,
        version: null,
        owned: false,
      }
      value.bridge = { connected: false, profileRequired: false, profiles: [] }
    }
    if (unknown)
      value.daemon = {
        state: "unknown",
        pid: null,
        version: null,
        owned: false,
      }
    let finishAt = 0
    return {
      read: async () => {
        if (value.operation?.state === "running" && Date.now() >= finishAt) {
          value.operation.state = fail ? "failed" : "succeeded"
          value.operation.phase = fail
            ? "官方版本查询未成功"
            : "隔离预览已核对结束结果"
          value.operation.error = fail
            ? "示例网络失败，请读取实际安装后重试；未自动重做。"
            : ""
          value.operation.endedAt = new Date().toISOString()
          if (!fail) {
            const action = value.operation.action
            if (action === "install" || action === "upgrade") {
              value.installation = exampleStatus().installation
              value.installation.version = "示例目标版本"
            }
            if (action === "uninstall")
              Object.assign(value.installation, {
                state: "not-installed",
                version: null,
                path: null,
                cliPath: null,
                daemonPath: null,
                usable: false,
              })
            if (["stop", "upgrade", "uninstall"].includes(action))
              value.daemon = {
                state: "stopped",
                pid: null,
                version: null,
                owned: false,
              }
            if (action === "start")
              value.daemon = {
                state: "running",
                pid: 12345,
                version: value.installation.version,
                owned: false,
              }
            if (value.daemon.state !== "running")
              value.bridge = {
                connected: false,
                profileRequired: false,
                profiles: [],
              }
          }
        }
        return structuredClone(value)
      },
      manage: async (action) => {
        value.operation = {
          id: "隔离操作",
          action,
          state: "running",
          phase: "读取官方版本和后台；预览等待两秒",
          startedAt: new Date().toISOString(),
          endedAt: null,
          beforeVersion: value.installation.version,
          targetVersion: ["install", "upgrade"].includes(action)
            ? "示例目标版本"
            : null,
          error: "",
        }
        finishAt = Date.now() + 2000
        return { operation: structuredClone(value.operation) }
      },
    }
  })
  return (
    <div className="p-6">
      <Page service={source} />
    </div>
  )
}

export default {
  id: "opencli-global-management",
  name: "OpenCLI全局软件与连接",
  layer: "复合组件",
  stage: "content",
  order: 181,
  pages: ["插件设置"],
  group: "插件",
  source: "backend/plugins/opencli/web.tsx",
  description:
    "正式Page与OpenCliConnectionView组合，读取全局安装、后台、Bridge及五项管理任务。",
  boundary:
    "预览注入独立内存服务，不执行npm、不修改配置、不连接后台。示例结果不能替代真实宿主验收。",
  story: {
    goal: "管理官方全局程序并核对软件、后台与浏览器连接。",
    preconditions: ["正式组件及隔离服务就绪。"],
    result: "阶段可读，执行中禁用冲突按钮，失败保留实际状态及重读入口。",
  },
  standards: [
    {
      id: "O1",
      name: "分别核对真实状态",
      rule: "安装版本、后台版本及Bridge连接独立显示；共享后台影响在动作前可读。",
      reason: "安装或启动成功不等于扩展在线。",
      check: "从未安装完成安装，再启动、停止；从已安装升级和卸载。",
    },
  ],
  inputs: ["OpenCliService / OpenCliStatus"],
  events: ["五项管理动作快速受理", "进行中轮询同一任务", "手动刷新"],
  composition: ["Page / OpenCliConnectionView / Button / Alert"],
  consumers: ["PluginSettings正式插件页"],
  viewport: { width: 720, height: 850 },
  states: [
    {
      id: "install",
      name: "未安装到安装和启动",
      section: "normal",
      condition: "初始没有官方程序。",
      expected:
        "安装期间显示目标版本，结束显示实际版本；随后可启动后台，Bridge连接独立。",
      steps: [
        "点击安装，观察进行中及按钮禁用。",
        "等待结束，核对软件版本和路径。",
        "启动再停止后台。",
      ],
      render: () => <Example missing />,
    },
    {
      id: "upgrade",
      name: "已有软件升级和卸载",
      section: "normal",
      condition: "存在官方安装与共享后台。",
      expected:
        "当前和目标版本、全局影响可读；升级或卸载后后台停止且配置保留说明仍在。",
      steps: [
        "阅读全局影响，点击升级。",
        "核对目标版本和结束状态。",
        "点击卸载，再读取实际状态。",
      ],
      render: () => <Example />,
    },
    {
      id: "failure",
      name: "管理失败可重读",
      section: "exception",
      condition: "隔离官方查询失败。",
      expected: "失败与原实际安装分别保留，动作不自动重做。",
      steps: ["点击升级并等待失败。", "刷新状态，核对错误和原版本。"],
      render: () => <Example fail />,
    },
    {
      id: "offline",
      name: "后台运行但Bridge离线",
      section: "states",
      condition: "已有后台，浏览器扩展未连接。",
      expected: "后台与Bridge状态分开；检查已运行后台沿原PID返回。",
      steps: ["检查已运行后台。", "核对PID保持，Bridge仍离线。"],
      render: () => <Example offline />,
    },
    {
      id: "unknown",
      name: "端口占用未确认",
      section: "exception",
      condition: "19825占用程序未知。",
      expected: "不提供误启动或停止未知程序的入口，可刷新核对。",
      steps: ["核对后台未知状态与禁用启动停止。", "刷新状态。"],
      render: () => <Example unknown />,
    },
  ],
} satisfies CatalogEntry
