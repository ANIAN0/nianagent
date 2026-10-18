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
  scenario: "starting" | "failed" | "opening" | "long" | "single"
}) {
  const [retrying, setRetrying] = useState(false)
  const [exitInstruction, setExitInstruction] = useState<string | null>(null)
  const failed = scenario !== "starting"
  const steps: StartupStep[] =
    scenario === "single"
      ? [
          {
            id: "interface",
            label: "加载启动界面",
            status: "failed",
            detail: "界面资源未能加载，请重新加载。",
          },
        ]
      : failed
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
          ? `Moon 启动诊断\n环境：组件库展示\n阶段：${steps.find((step) => step.status === "failed")?.label}\n原因：${steps.find((step) => step.status === "failed")?.detail}`
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
    "统一启动入口：安静画布上的一颗呼吸点，慢启动超时后淡入真实阶段提示，失败给出可恢复动作，服从当前宿主能力。",
  boundary:
    "直接使用正式StartupSurface；组件库不连接业务宿主、不按定时器进入成功，不替代正式启动验收。",
  standards: [
    {
      id: "B1",
      name: "真实阶段",
      rule: "仅呈现当前已知启动步骤，不猜百分比或完成时间；呼吸点只表示等待，阶段提示在超过1.5秒后淡入。",
      reason: "呼吸的点不证明服务或数据已就绪；快启动不需要文字交代。",
      check: "等待超过1.5秒出现阶段提示，展开详情核对真实步骤。",
    },
    {
      id: "B2",
      name: "可恢复失败",
      rule: "失败时刻只有一个决定（是否重试）：全页唯一实体按钮是实心重试；查看详情与退出是同行文字级动作，复制诊断收进它作用的详情内容里，均不使用按钮外观；兜底入口保护镜像同一结构。",
      reason:
        "一行对等按钮把罕见诊断与破坏性退出抬成与恢复同级的选项；动作层级靠元素类型区分，而不是靠同色按钮的颜色深浅。",
      check:
        "失败页有且仅有一个实心元素；展开详情后复制可用且反馈真实；重试展示保持等待，不伪造成功。",
    },
    {
      id: "B3",
      name: "稳定阅读位置",
      rule: "内容在视口内垂直居中，详情从触发器下方向下展开。",
      reason: "居中让启动与失败两种内容量都保持视觉平衡，展开不遮挡阶段信息。",
      check: "展开和收起详情，阶段提示与失败操作保持可见。",
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
    "StartupSurface → Button / Collapsible，与 HTML 入口保护共用呼吸点、阶段提示与阅读锚点",
  ],
  consumers: ["正式正常启动BootApp", "React资源加载失败前的同视觉入口保护"],
  viewport: { width: 680, height: 560 },
  states: [
    {
      id: "single",
      name: "单阶段失败诊断",
      section: "exception",
      condition: "仅加载界面一个阶段失败，并提供安全诊断。",
      expected: "仍可展开详情、复制诊断并重试。",
      steps: ["展开详情。", "复制诊断并检查成功反馈。"],
      render: () => <StartupExample scenario="single" />,
    },
    {
      id: "starting",
      name: "启动中",
      section: "normal",
      condition: "当前真实阶段进行中。",
      expected: "呼吸点居中；1.5秒后淡入12px阶段提示；多阶段详情默认收起。",
      steps: ["展开详情查看已完成/当前/待执行步骤。"],
      render: () => <StartupExample scenario="starting" />,
    },
    {
      id: "failed",
      name: "失败与重试等待",
      section: "exception",
      condition: "服务尚未就绪。",
      expected:
        "具体原因在上；唯一实心重试按钮居中；查看详情与退出是文字级同行；复制诊断在详情内。",
      steps: [
        "核对页面上只有一个实心按钮。",
        "展开详情，在详情内复制诊断并核对真实复制反馈。",
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
      expected: "文字级操作同行、详情局部滚动、页面自然纵向滚动，不缩小文字。",
      steps: ["展开详情。", "切换浅深主题及窄窗查看完整动作。"],
      render: () => <StartupExample scenario="long" />,
    },
  ],
} satisfies CatalogEntry
