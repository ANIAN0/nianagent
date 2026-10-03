import { useRef, useState } from "react"
import { FileText, Sparkles } from "lucide-react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { MaterialCandidateList } from "./material-candidate-list"
function Example({ error = false, loading = false }: { error?: boolean; loading?: boolean }) {
  const list = useRef<HTMLDivElement>(null); const [active, setActive] = useState(0); const [result, setResult] = useState("")
  return <div className="m-6 max-w-xl rounded-xl bg-popover p-1 ring-1 ring-border"><MaterialCandidateList id="example-resource" rows={[{ id: "file", group: "文件", name: "README.md", description: "docs/使用说明/README.md", icon: FileText }, { id: "skill", group: "Skills", name: "code-review", description: "检查正确性 · .agents/skills/code-review/SKILL.md", icon: Sparkles }]} active={active} listRef={list} maxHeight={280} loading={loading} error={error ? "工作目录无法读取，请重新选择。" : undefined} onRetry={() => setResult("已请求重读（展示）")} onActive={setActive} onSelect={(item) => setResult(`选择了${item.name}（展示）`)} /><p role="status" className="px-3 py-1 text-xs">{result}</p></div>
}
export default {
  id: "material-candidate-list", name: "资源候选列表", layer: "复合组件", group: "工作输入", source: "src/features/materials/material-candidate-list.tsx", description: "文件与Skills共享名称、来源与键盘活动行的候选列表。", boundary: "仅呈现已发现数据和选择事件，资源读取与焦点由MaterialPicker负责。", inputs: ["rows、active、loading/error、maxHeight"], events: ["onActive、onSelect、onRetry"], composition: ["Button"], consumers: ["MaterialPicker"], viewport: { width: 720, height: 380 }, states: [
    { id: "ready", name: "名称与来源", condition: "文件和Skill资源", expected: "来源位于名称下方，名称与来源可区分", render: () => <Example /> },
    { id: "loading", name: "读取中", condition: "异步发现未结束", expected: "保留候选位置与忙状态", render: () => <Example loading /> },
    { id: "error", name: "读取失败", condition: "资源目录不可读", expected: "原位显示原因与重新读取", render: () => <Example error /> },
  ],
} satisfies CatalogEntry
