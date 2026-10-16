import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { StartupSurface, type StartupStep } from "./startup-surface"

const startingSteps: StartupStep[] = [
  { id: "profile", label: "核对数据目录", status: "complete" },
  { id: "service", label: "连接本地服务", status: "active" },
  { id: "restore", label: "恢复本机草稿", status: "pending" },
  { id: "workbench", label: "加载工作台", status: "pending" },
]

function StartupExample({
  scenario,
}: {
  scenario: "starting" | "failed" | "opening" | "long"
}) {
  const [retrying, setRetrying] = useState(false)
  const [exitInstruction, setExitInstruction] = useState<string | null>(null)
  const failed = scenario !== "starting"
  const steps = failed
    ? startingSteps.map((step) =>
        step.id === "service"
          ? {
              ...step,
              status: "failed" as const,
              detail:
                scenario === "long"
                  ? "新的数据目录 D:/应用与工作资料/Moon/长期保留的专用数据与桌面草稿目录 尚未完成服务恢复，请检查安装资源与该目录的访问权限。"
                  : "Moon 本地服务尚未就绪，请处理运行资源后重试。",
            }
          : step
      )
    : startingSteps
  return (
    <StartupSurface
      status={failed ? "failed" : "starting"}
      steps={steps}
      failureTitle={
        scenario === "opening" ? "数据已迁移，启动需要处理" : undefined
      }
      pending={retrying ? "retry" : null}
      diagnostics={
        failed
          ? "Moon 启动诊断\n环境：组件库展示\n阶段：连接本地服务\n原因：本地服务尚未就绪。"
          : ""
      }
      exitInstruction={exitInstruction}
      onRetry={
        failed && scenario !== "opening" ? () => setRetrying(true) : undefined
      }
      onExit={
        failed
          ? () =>
              setExitInstruction(
                "这是组件库展示；实际退出由正式宿主执行，可以关闭此预览。"
              )
          : undefined
      }
    />
  )
}

export default {
  id: "startup-surface",
  name: "Moon 启动页",
  source: "src/features/startup/startup-surface.tsx",
  group: "页面与流程",
  layer: "页面",
  order: 3,
  pages: ["启动"],
  stage: "content",
  description:
    "旧设计的正式启动页：居中字标、真实当前阶段和按需详情，失败动作服从当前宿主能力。",
  boundary:
    "直接使用正式StartupSurface；组件库不连接业务宿主、不按定时器进入成功，不替代正式启动验收。",
  standards: [
    {
      id: "B1",
      name: "真实阶段",
      rule: "仅呈现当前已知启动步骤，不猜百分比或完成时间。",
      reason: "转动的环表示等待，不证明服务或数据已就绪。",
      check: "查看当前阶段及展开详情，未执行步骤保持待执行。",
    },
    {
      id: "B2",
      name: "可恢复失败",
      rule: "失败原因与合法重试、复制安全诊断、实际退出同组。",
      reason: "重新读取不能伪装为启动已经停止的服务。",
      check: "重试展示保持等待，不伪造成功；复制使用真实剪贴板结果。",
    },
  ],
  inputs: [
    "status / steps / message / failureTitle / diagnostics",
    "pending / onRetry / onExit / exitInstruction",
  ],
  events: [
    "合法重试或退出交由宿主执行",
    "复制仅取调用方提供的受控诊断，真实剪贴板成功后才反馈",
  ],
  composition: [
    "StartupSurface → Button / Collapsible / Separator，startup-surface.css沿旧StartupSurface尺度",
  ],
  consumers: ["正式正常启动BootApp", "React资源加载失败前的同视觉入口保护"],
  viewport: { width: 680, height: 560 },
  states: [
    {
      id: "starting",
      name: "启动中",
      section: "normal",
      condition: "当前真实阶段进行中。",
      expected: "Moon字标、20px环、阶段文本，详情默认收起。",
      steps: ["展开详情查看已完成/当前/待执行步骤。"],
      render: () => <StartupExample scenario="starting" />,
    },
    {
      id: "failed",
      name: "失败与重试等待",
      section: "exception",
      condition: "服务尚未就绪。",
      expected: "具体原因和动作同组；重试不会自动完成。",
      steps: [
        "展开详情。",
        "复制诊断并核对真实复制反馈。",
        "点击重试观察等待。",
      ],
      render: () => <StartupExample scenario="failed" />,
    },
    {
      id: "opening",
      name: "已导入后的启动失败",
      section: "exception",
      condition: "原生已证明数据提交、当前服务不可恢复。",
      expected: "已迁移事实清楚，不给无效重读，只保留诊断及合法退出。",
      steps: ["阅读标题与受控原因。", "检查退出提示。"],
      render: () => <StartupExample scenario="opening" />,
    },
    {
      id: "long",
      name: "长原因与窄窗",
      section: "states",
      condition: "较长安全原因及520×420短窗。",
      expected: "动作可换行、详情局部滚动、页面自然纵向滚动，不缩小文字。",
      steps: ["展开详情。", "切换浅深主题及窄窗查看完整动作。"],
      render: () => <StartupExample scenario="long" />,
    },
  ],
} satisfies CatalogEntry
