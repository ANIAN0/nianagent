import { useRef, useState } from "react"
import { FileText, Sparkles, Terminal } from "lucide-react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { MaterialCandidateList } from "./material-candidate-list"
function Example({
  error = false,
  cancelled = false,
  loading = false,
  commands = false,
  restart = false,
}: {
  error?: boolean
  cancelled?: boolean
  loading?: boolean
  commands?: boolean
  restart?: boolean
}) {
  const list = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [result, setResult] = useState("")
  const [recovered, setRecovered] = useState(false)
  return (
    <div className="m-6 max-w-xl rounded-xl bg-popover p-1 ring-1 ring-border">
      <MaterialCandidateList
        id="example-resource"
        rows={
          commands
            ? [
                {
                  id: "compact",
                  group: "内置命令",
                  name: "压缩上下文 · /compact",
                  description: "填入调用，再打开重点面板",
                  icon: Terminal,
                },
                {
                  id: "skill",
                  group: "Skill 调用",
                  name: "code-review",
                  description:
                    "检查正确性 · .agents/skills/code-review/SKILL.md",
                  icon: Sparkles,
                },
              ]
            : [
                {
                  id: "file",
                  group: "工作区文件",
                  name: "README.md",
                  description: "docs/使用说明/README.md",
                  icon: FileText,
                },
                {
                  id: "skill",
                  group: "Skills",
                  name: "code-review",
                  description:
                    "检查正确性 · .agents/skills/code-review/SKILL.md",
                  icon: Sparkles,
                },
              ]
        }
        active={active}
        listRef={list}
        maxHeight={320}
        loading={loading}
        error={
          error && !recovered ? "工作目录暂时无法读取，请重新读取。" : undefined
        }
        issue={
          restart
            ? {
                code: "host_version",
                message: "资源服务版本已更新，需要重新启动 Moon。",
                severity: "warning",
                recovery: "restart",
              }
            : !recovered && (cancelled || (error && commands))
              ? cancelled
                ? {
                    code: "cancelled",
                    message: "资源读取已取消，可重新读取。",
                    recovery: "retry",
                  }
                : {
                    code: "material_catalog_unavailable",
                    message: "Skill 目录暂时无法读取，请重新读取。",
                    details: "资源发现暂不可用；内置命令不依赖本次读取。",
                    recovery: "retry",
                  }
              : undefined
        }
        statusGroup={commands ? "Skill 调用" : undefined}
        onRetry={() => setRecovered(true)}
        onActive={setActive}
        onSelect={(item) => setResult(`选择了${item.name}（展示）`)}
      />
      {result && (
        <p role="status" className="px-3 py-1 text-xs">
          {result}
        </p>
      )}
    </div>
  )
}
export default {
  id: "material-candidate-list",
  name: "资源候选列表",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/materials/material-candidate-list.tsx",
  description: "按来源分组的材料与命令候选列表，资源失败保留独立命令入口。",
  boundary: "仅呈现已发现数据和选择事件，资源读取与焦点由MaterialPicker负责。",
  inputs: [
    "rows、active、loading/error、issue（结构化反馈，优先于兼容error）、maxHeight、statusGroup、label、emptyMessage",
  ],
  events: ["onActive、onSelect、onRetry"],
  composition: ["Button、OperationFeedback"],
  consumers: ["MaterialPicker"],
  viewport: { width: 720, height: 420 },
  states: [
    {
      id: "restart",
      name: "资源服务需要重启",
      condition: "资源读取返回host_version/restart/warning。",
      expected:
        "警告层级与重启指导保留，不提供无法恢复的重复读取；内置命令不受资源加载影响。",
      render: () => <Example commands restart />,
    },
    {
      id: "ready",
      name: "名称与来源",
      condition: "文件和Skill资源",
      expected: "来源位于名称下方，名称与来源可区分",
      render: () => <Example />,
    },
    {
      id: "loading",
      name: "读取中",
      condition: "异步发现未结束",
      expected: "保留候选位置与忙状态",
      render: () => <Example loading />,
    },
    {
      id: "error",
      name: "读取失败",
      condition: "资源目录不可读",
      expected: "原位显示原因与重新读取",
      render: () => <Example error />,
    },
    {
      id: "partial-error",
      name: "Skill失败仍可选命令",
      condition: "Skill资源不可读，内置命令独立可用",
      expected: "只在Skill组展示错误，命令仍可选；重新读取恢复该组",
      render: () => <Example error commands />,
    },
    {
      id: "cancelled",
      name: "取消读取与重读",
      condition: "当前Skill读取取消",
      expected: "只在Skill组显示中性取消反馈；保留命令、重读后恢复资源",
      render: () => <Example cancelled commands />,
    },
  ],
} satisfies CatalogEntry
