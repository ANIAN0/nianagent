import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import type { StartupSnapshot } from "@/contracts/desktop.generated"
import {
  StartupMigrationView,
  type StartupAction,
} from "./startup-migration-view"
import type { StartupView } from "./startup-service"

type Scenario =
  | "confirmation"
  | "long-path"
  | "dependency-failure"
  | "target-failure"
  | "retry"
  | "copying"
  | "opening-failure"
  | "unknown"
  | "expired"
  | "fresh"
  | "fresh-opening"
function initialSnapshot(scenario: Scenario): StartupSnapshot {
  const snapshot: StartupSnapshot = {
    revision: 1,
    operationId: null,
    planId: null,
    planExpiresAt: null,
    phase: "awaitingConfirmation",
    selection: null,
    sourceDirectory: "C:/Users/使用者/AppData/Local/Moon/models",
    legacyProfileDirectory: "C:/Users/使用者/AppData/Local/local.moon.desktop",
    targetDirectory: "D:/Apps/Moon/data",
    defaultDirectory: "D:/Apps/Moon/data",
    retainedCopyDirectories: [],
    fileCount: null,
    totalBytes: null,
    availableBytes: null,
    completedFiles: 0,
    copiedBytes: null,
    issue: null,
    capabilities: {
      chooseDirectory: true,
      prepare: true,
      migrate: false,
      createFresh: false,
      retry: false,
      openDiagnostics: true,
      exit: true,
      continueStartup: false,
    },
  }
  if (scenario === "long-path") {
    snapshot.sourceDirectory =
      "C:/Users/很长的中文账户名称/AppData/Local/Moon/models/此前保存的会话与模型配置目录"
    snapshot.targetDirectory =
      "D:/应用与个人工作资料/Moon/需要保留完整内容的专用数据目录/新的长期数据存储位置"
  }
  if (scenario === "copying") {
    snapshot.phase = "copying"
    snapshot.operationId = "catalog-operation"
    snapshot.fileCount = 248
    snapshot.totalBytes = 134217728
    snapshot.completedFiles = 68
    snapshot.copiedBytes = 36700160
    snapshot.capabilities = {
      ...snapshot.capabilities,
      chooseDirectory: false,
      prepare: false,
      exit: false,
    }
  } else if (scenario === "dependency-failure") {
    snapshot.phase = "failed"
    snapshot.issue = {
      code: "dependencyMissing",
      stage: "runtime",
      message: "内置迁移服务依赖缺失，当前安装资源不完整。",
      path: "D:/Apps/Moon/runtime",
      retryable: false,
    }
  } else if (scenario === "target-failure") {
    snapshot.phase = "failed"
    snapshot.issue = {
      code: "targetInvalid",
      stage: "target",
      message: "此目录已有其他文件，不能用作新的 Moon 数据目录。",
      path: snapshot.targetDirectory,
      retryable: false,
    }
  } else if (scenario === "retry") {
    snapshot.phase = "failed"
    snapshot.operationId = "catalog-operation"
    snapshot.issue = {
      code: "interrupted",
      stage: "copying",
      message: "上次复制没有完成，原数据和本次记录已保留。",
      path: snapshot.targetDirectory,
      retryable: true,
    }
    snapshot.capabilities.retry = true
  } else if (scenario === "opening-failure") {
    snapshot.phase = "readyToOpen"
    snapshot.operationId = "catalog-operation"
    snapshot.retainedCopyDirectories = [snapshot.sourceDirectory]
    snapshot.issue = {
      code: "internal",
      stage: "opening",
      message: "新的数据目录已启用，但 Moon 尚未确认启动。",
      path: null,
      retryable: false,
    }
    snapshot.capabilities = {
      ...snapshot.capabilities,
      chooseDirectory: false,
      prepare: false,
      continueStartup: true,
    }
  } else if (scenario === "expired") {
    snapshot.phase = "ready"
    snapshot.planId = "catalog-expired"
    snapshot.planExpiresAt = "2000-01-01T00:00:00.000Z"
    snapshot.fileCount = 248
    snapshot.totalBytes = 134217728
    snapshot.capabilities.migrate = true
  }
  if (
    [
      "copying",
      "dependency-failure",
      "retry",
      "opening-failure",
      "expired",
    ].includes(scenario)
  )
    snapshot.selection = "import"
  if (scenario === "fresh" || scenario === "fresh-opening") {
    snapshot.selection = "fresh"
    snapshot.operationId = "catalog-fresh-operation"
    snapshot.phase = scenario === "fresh" ? "committing" : "readyToOpen"
    snapshot.capabilities = {
      ...snapshot.capabilities,
      chooseDirectory: false,
      prepare: false,
      exit: scenario === "fresh-opening",
      continueStartup: scenario === "fresh-opening",
    }
    if (scenario === "fresh-opening")
      snapshot.issue = {
        code: "internal",
        stage: "opening",
        message: "新的数据目录已启用，但 Moon 尚未确认启动。旧文件保留。",
        path: null,
        retryable: false,
      }
  }
  return snapshot
}

/** 组件库只驱动正式 view 的内存展示，不连接 Tauri、真实目录或启动服务。 */
function StartupExample({ scenario }: { scenario: Scenario }) {
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(scenario))
  const [target, setTarget] = useState(snapshot.targetDirectory)
  const [planValid, setPlanValid] = useState(false)
  const [expired, setExpired] = useState(scenario === "expired")
  const [connectionIssue, setConnectionIssue] = useState<StartupView["issue"]>(
    scenario === "unknown"
      ? {
          message: "启动状态未能读取，请重新读取并核对当前操作。",
          retryable: true,
        }
      : null
  )
  const [pending, setPending] = useState<StartupAction | null>(null)

  function action(action: StartupAction) {
    if (action === "refresh") setConnectionIssue(null)
    else if (action === "choose") {
      setTarget("E:/MoonData")
      setPlanValid(false)
    } else if (action === "prepare") {
      setExpired(false)
      setPlanValid(true)
      setSnapshot((current) => ({
        ...current,
        revision: current.revision + 1,
        phase: "ready",
        selection: "import",
        targetDirectory: target,
        planId: "catalog-plan",
        planExpiresAt: "2099-01-01T00:00:00.000Z",
        issue: null,
        fileCount: 248,
        totalBytes: 134217728,
        availableBytes: 34359738368,
        capabilities: { ...current.capabilities, migrate: true, retry: false },
      }))
    } else if (action === "fresh") {
      setPlanValid(false)
      setSnapshot((current) => ({
        ...current,
        revision: current.revision + 1,
        selection: "fresh",
        phase: "committing",
        operationId: "catalog-fresh-operation",
        issue: null,
        fileCount: null,
        totalBytes: null,
        availableBytes: null,
        capabilities: {
          ...current.capabilities,
          chooseDirectory: false,
          prepare: false,
          migrate: false,
          createFresh: false,
          retry: false,
          exit: false,
        },
      }))
    } else if (action === "start" || action === "retry") {
      setPlanValid(false)
      setSnapshot((current) => ({
        ...current,
        revision: current.revision + 1,
        phase: "copying",
        operationId: current.operationId ?? "catalog-operation",
        issue: null,
        fileCount: 248,
        totalBytes: 134217728,
        completedFiles: 68,
        copiedBytes: 36700160,
        capabilities: {
          ...current.capabilities,
          chooseDirectory: false,
          prepare: false,
          migrate: false,
          retry: false,
          exit: false,
        },
      }))
    } else if (action === "continue") {
      setSnapshot((current) => ({
        ...current,
        revision: current.revision + 1,
        issue: {
          code: "internal",
          stage: "opening",
          message: "组件库仅展示界面，启动 Moon 需要桌面环境。",
          path: null,
          retryable: false,
        },
      }))
    } else if (action === "exit" || action === "diagnostics") {
      setPending(action)
      queueMicrotask(() => setPending(null))
    }
  }
  return (
    <StartupMigrationView
      view={{
        snapshot,
        loaded: true,
        listening: connectionIssue === null,
        issue: connectionIssue,
      }}
      target={target}
      planValid={planValid}
      expired={expired}
      pending={pending}
      onTargetChange={(value) => {
        setTarget(value)
        setPlanValid(false)
      }}
      onAction={action}
    />
  )
}

export default {
  id: "startup-migration",
  name: "首次启动数据选择",
  layer: "页面",
  stage: "content",
  order: 235,
  pages: ["首次启动"],
  group: "设置与启动",
  source: "src/features/startup/startup-migration-view.tsx",
  description:
    "在业务数据与 profile 启用前，明确可选导入或新建数据集，呈现真实阶段及同操作恢复。",
  boundary:
    "直接使用正式 StartupMigrationView。组件库只提供内存展示，不读写用户数据，不启动真实迁移或 Moon；预览不能代替原生生命周期验收。",
  inputs: ["原生 StartupSnapshot/连接状态、目标输入、计划有效性、请求等待状态"],
  events: [
    "选择目录、预检、明确迁移、同操作重试、核对状态、已提交后启动、打开记录、退出",
  ],
  composition: [
    "FieldGroup / Field / InputGroup / Button / StatusMessage / Collapsible / Separator",
  ],
  consumers: ["StartupMigrationApp 首次启动窗口"],
  standards: [
    {
      id: "startup-task",
      name: "完整迁移任务",
      rule: "首次明确可选导入或新建数据集；旧文件保留；真实阶段与能力一致，已提交不重新复制。",
      reason: "让用户清楚数据去向和失败恢复动作，避免误进入空白业务数据。",
      check:
        "在完整正式入口检查；组件库仅核对浅深主题、长路径、短窗及连续组合。",
    },
    {
      id: "startup-plan",
      name: "计划与目标绑定",
      rule: "编辑或过期后必须重新预检；开始使用权威planId和目标；未知结果只核对当前操作。",
      reason: "阻止旧计划作用于新目标或重复执行。",
      check: "检查后修改目标、重新检查，再明确迁移；过期与失联恢复分别呈现。",
    },
  ],
  viewport: { width: 680, height: 560 },
  states: [
    {
      id: "confirmation",
      name: "可选导入或直接启动",
      section: "normal",
      condition: "发现旧数据，尚未检查目标。",
      expected:
        "两种选择明确；导入经检查确认，新建一次明确点击，不额外迁移确认；旧文件保留。",
      steps: [
        "检查目录，读取真实结构的源/目标与规模。",
        "编辑目标使旧计划失效，再检查后明确迁移。",
        "另看不导入直接启动的初始化组合；展示不按定时器完成。",
      ],
      render: () => <StartupExample scenario="confirmation" />,
    },
    {
      id: "long-path",
      name: "长路径与窄窗",
      section: "states",
      condition: "源与目标包含较长中文目录。",
      expected: "路径可换行/选择，操作可达，不缩小文字。",
      steps: ["以520×420和浅深主题查看完整页面。", "修改并检查目标。"],
      render: () => <StartupExample scenario="long-path" />,
    },
    {
      id: "copying",
      name: "复制与核验阶段",
      section: "states",
      condition: "已有真实结构的复制数量。",
      expected: "不显示假的全流程百分比；阶段按事实表达。",
      steps: ["查看源/目标和文件进度。", "观察核验、提交及启动阶段的显示。"],
      render: () => <StartupExample scenario="copying" />,
    },
    {
      id: "fresh",
      name: "不导入的新数据集",
      section: "states",
      condition: "用户明确选择不导入，空目录预检后正在提交新数据集。",
      expected: "不把初始化称为复制旧数据，不按定时器伪造完成。",
      steps: ["核对标题、原副本保留与当前初始化阶段。"],
      render: () => <StartupExample scenario="fresh" />,
    },
    {
      id: "fresh-opening",
      name: "新数据集已启用的启动恢复",
      section: "exception",
      condition: "fresh已提交，后续启动未确认。",
      expected: "明确新目录已启用，不声称导入旧数据，也不再次初始化或换根。",
      steps: ["核对可用启动、记录与退出动作。"],
      render: () => <StartupExample scenario="fresh-opening" />,
    },
    {
      id: "dependency-failure",
      name: "运行依赖缺失",
      section: "exception",
      condition: "迁移组件加载前失败。",
      expected: "指出运行资源不完整，不能把问题泛化成权限或占用。",
      steps: ["阅读具体原因和恢复指引。", "展开详情查看失败阶段和相关位置。"],
      render: () => <StartupExample scenario="dependency-failure" />,
    },
    {
      id: "target-failure",
      name: "目标目录已有文件",
      section: "exception",
      condition: "预检明确拒绝目标。",
      expected: "保留目标输入与原数据，可改目录后重新检查。",
      steps: ["检查原因，修改或选择目标。", "重新检查后确认。"],
      render: () => <StartupExample scenario="target-failure" />,
    },
    {
      id: "retry",
      name: "未提交操作的恢复",
      section: "exception",
      condition: "上次复制中断，同操作允许重试。",
      expected: "保留原目录与记录，只重试同一身份。",
      steps: ["阅读保留说明。", "明确重试后观察正式组合。"],
      render: () => <StartupExample scenario="retry" />,
    },
    {
      id: "opening-failure",
      name: "已迁移但启动需要处理",
      section: "exception",
      condition: "bootstrap已提交，启动未确认。",
      expected: "仅提供合法启动/诊断/退出，不换目标或重试复制。",
      steps: ["核对已启用目录与说明。", "检查合法启动恢复入口。"],
      render: () => <StartupExample scenario="opening-failure" />,
    },
    {
      id: "unknown",
      name: "状态连接未确认",
      section: "exception",
      condition: "原生状态通道失联。",
      expected: "禁用开始动作，重新读取状态后才继续。",
      steps: ["观察目录/迁移动作被禁用。", "读取状态恢复当前任务。"],
      render: () => <StartupExample scenario="unknown" />,
    },
    {
      id: "expired",
      name: "检查结果过期",
      section: "exception",
      condition: "宿主计划期限已到。",
      expected: "先重新检查，不允许旧计划迁移。",
      steps: ["阅读过期提示。", "重新检查后确认迁移。"],
      render: () => <StartupExample scenario="expired" />,
    },
  ],
} satisfies CatalogEntry
