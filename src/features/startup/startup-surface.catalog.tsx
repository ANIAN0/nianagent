import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import type { StartupStep } from "./startup-surface"
import { BreathingStartupSurface } from "./breathing/startup-breathing"

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
                      : scenario === "opening"
                        ? "数据迁移已完成，本地服务仍未就绪。请退出 Moon 后重新打开。"
                        : "Moon 本地服务尚未就绪，请处理运行资源后重试。",
                }
              : step
          )
        : startingSteps
  return (
    <BreathingStartupSurface
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
  source: "src/features/startup/breathing/startup-breathing.tsx",
  group: "设置与启动",
  layer: "页面",
  order: 3,
  pages: ["启动"],
  stage: "content",
  description:
    "「月息」呼吸月体启动页：在正式启动阶段下呈现等待与失败恢复，包含慢启动详情弹窗。",
  boundary:
    "月息包装正式StartupSurface并沿用其恢复行为；组件库不连接业务宿主、不按定时器进入成功，不替代正式启动验收。",
  standards: [
    {
      id: "B4",
      name: "月息呼吸方案",
      rule: "月息的月体与柔光共享4.8秒周期；启动、失败、重试共用品牌位置与尺寸，文字保持静止；失败与阅读详情时暂停呼吸，真实重试恢复呼吸，减少动态模式保持静止。",
      reason: "扩张与收回需要清楚可见，又不应带动整页或被理解为启动进度。",
      check: "打开详情弹窗并关闭，切换失败、浅深主题和减少动态模式。",
    },
    {
      id: "B1",
      name: "真实阶段",
      rule: "仅呈现当前已知启动步骤，不猜百分比或完成时间；月体呼吸只表示等待，详情入口在超过1.5秒后淡入。",
      reason: "呼吸的月体不证明服务或数据已就绪；快启动不需要文字交代。",
      check: "等待超过1.5秒淡入详情入口，展开详情核对真实步骤。",
    },
    {
      id: "B2",
      name: "可恢复失败",
      rule: "失败时刻只有一个决定（是否重试）：异常详情在失败时自动弹出且不可关闭，重试与退出就在弹窗内；页面保持月体与字标，一行状态宣告失败；复制诊断收进弹窗；兜底入口保护镜像同一结构。",
      reason:
        "报了异常就不提供关闭出口：决定在弹窗内做出，页面骨架不被失败改写。",
      check:
        "失败时弹窗自动打开且无关闭出口；重试显示等待并恢复月体呼吸；复制反馈真实。",
    },
    {
      id: "B3",
      name: "稳定阅读位置",
      rule: "月息使用启动详情弹窗，长内容在正文中滚动，标题、关闭和复制操作固定可见；关闭后焦点回到详情入口。",
      reason:
        "查看完整阶段不应推动月体和恢复动作；短窗也需要能关闭和复制诊断。",
      check:
        "打开详情，检查Tab焦点范围；用关闭按钮与Escape分别关闭并核对焦点回归。",
    },
  ],
  inputs: [
    "status / steps / message / failureTitle / diagnostics",
    "pending / onRetry / onExit / exitInstruction",
    "detailsView：可选详情展示组件；月息提供独立弹窗",
    "failureView：可选失败内容展示组件；恢复行为由StartupSurface统一管理",
  ],
  events: [
    "合法重试或退出交由宿主执行",
    "复制仅取调用方提供的受控诊断，真实剪贴板成功后才反馈",
  ],
  composition: [
    "BreathingStartupSurface → StartupSurface / BreathingStartupFailure / StartupDetailsDialog → Dialog：与 HTML 入口保护共用品牌锚点、阶段提示与阅读锚点；恢复行为由StartupSurface统一管理",
  ],
  consumers: ["正式正常启动BootApp", "React资源加载失败前的同视觉入口保护"],
  viewport: { width: 680, height: 560 },
  states: [
    {
      id: "breathing",
      name: "月息 · 新启动页",
      section: "normal",
      condition: "月息设计方案，使用正式启动阶段。",
      expected:
        "月体与柔光在4.8秒内平滑舒展、收回；Moon字标保持静止；1.5秒后淡入详情入口。",
      steps: [
        "观察一个完整呼吸周期。",
        "点击查看详情，核对阶段后用Escape关闭。",
      ],
      render: () => <StartupExample scenario="starting" />,
    },
    {
      id: "breathing-failed",
      name: "月息 · 失败与重试",
      section: "exception",
      condition: "新方案中本地服务未就绪。",
      expected:
        "失败即自动打开启动异常弹窗并保持打开：标题下是原因，正文为阶段，重试、退出与复制诊断集中在弹窗底部同一动作区；重试时月体恢复呼吸，详情保留上次失败。",
      steps: [
        "核对弹窗自动打开、无关闭出口，重试、退出与复制诊断同在底部动作区。",
        "点击重试：月体恢复呼吸，主状态显示正在重试。",
      ],
      render: () => <StartupExample scenario="failed" />,
    },
    {
      id: "breathing-opening",
      name: "月息 · 已迁移后的启动失败",
      section: "exception",
      condition: "数据已迁移，但当前服务不可恢复，没有合法重试能力。",
      expected:
        "保留相同品牌与状态层级，明确已迁移事实，只提供详情与合法退出。",
      steps: ["阅读已迁移事实。", "打开详情、复制诊断并检查退出提示。"],
      render: () => <StartupExample scenario="opening" />,
    },
    {
      id: "breathing-long",
      name: "月息 · 长原因与窄窗",
      section: "states",
      condition: "新方案下的长失败原因及窄短窗口。",
      expected:
        "长文自然换行，弹窗正文局部滚动，关闭与复制操作始终可达，支持浅深主题。",
      steps: [
        "切换窄窗和主题。",
        "打开详情弹窗，检查正文滚动、复制操作与键盘焦点。",
      ],
      render: () => <StartupExample scenario="long" />,
    },
    {
      id: "breathing-single",
      name: "月息 · 单阶段诊断",
      section: "exception",
      condition: "只加载启动界面一个阶段失败，并提供受控诊断。",
      expected: "单阶段也能打开详情与复制诊断；月体保持静止。",
      steps: ["打开详情核对一个失败阶段。", "复制诊断并用关闭按钮返回。"],
      render: () => <StartupExample scenario="single" />,
    },
  ],
} satisfies CatalogEntry
