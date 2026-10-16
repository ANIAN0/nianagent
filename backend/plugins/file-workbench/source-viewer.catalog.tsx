import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { SourceViewer, type SourceSelection } from "./source-viewer"
import "./web.css"

function SourceExample({ empty = false }: { empty?: boolean }) {
  const [selection, setSelection] = useState<SourceSelection>()
  const [scroll, setScroll] = useState(0)
  return (
    <div className="file-body h-full">
      <p className="file-page-caption">只读源码 · 从第21行开始</p>
      <SourceViewer
        name="example.ts"
        content={
          empty
            ? ""
            : 'export const name = "Moon"\r\nexport const version = "0.2.0"\rexport const visible = true\n'
        }
        line={21}
        scroll={scroll}
        onScroll={setScroll}
        onSelect={setSelection}
      />
      <p className="file-page-caption" role="status">
        {selection
          ? `实际选区：第${selection.lineStart}–${selection.lineEnd}行 · ${selection.text}`
          : "选择源码文字以查看实际范围。"}
      </p>
    </div>
  )
}
export default {
  id: "file-source-viewer",
  name: "只读源码与实际选区",
  source: "backend/plugins/file-workbench/source-viewer.tsx",
  group: "文件工作栏",
  layer: "复合组件",
  order: 180,
  pages: ["会话", "文件工作栏"],
  stage: "content",
  description:
    "正式CodeMirror源码组件，包含必要语言、高亮、行号与实际选区回调。",
  boundary:
    "此组合仅演示实际编辑器选区和只读行为；材料身份、发送与真实文件读取由正式工作栏另验。",
  story: {
    goal: "准确阅读和选择当前源码，保持只读内容。",
    preconditions: ["消费者提供当前内容、起始行号和选区回调。"],
    result: "选区回传实际原文和范围；清空选区后不保留旧选择。",
  },
  standards: [
    {
      id: "F1",
      name: "只读和准确范围",
      rule: "不可手动修改；行号含分页偏移，选区文字对应原内容，混合换行不能导致位置漂移。",
      reason: "引用必须保留用户当时所选的实际文字。",
      check: "选择第二行并核对第22行和原文字；键入不改变内容。",
    },
  ],
  inputs: ["content / name / line / scroll"],
  events: [
    "onSelect返回实际文字和行列；取消选区返回undefined",
    "onScroll保存消费者阅读位置",
  ],
  composition: [
    "SourceViewer / CodeMirror EditorView / JavaScript与Markdown语言 / 行号与只读扩展",
  ],
  consumers: ["文件工作栏FileBody"],
  states: [
    {
      id: "selection",
      name: "选择只读源码",
      section: "normal",
      condition: "分页从第21行起，包含CRLF、CR和LF。",
      steps: ["选择第二行文字。", "取消选择。", "尝试输入。"],
      expected: "范围和原文字准确；取消后清空选区；原内容不变。",
      render: () => <SourceExample />,
    },
    {
      id: "read-only",
      name: "输入不能改写",
      section: "exception",
      condition: "只读源码获得焦点。",
      steps: ["选择源码并尝试键入或删除。", "重新核对原文字。"],
      expected: "原内容保持不变，不能将编辑尝试变成文件修改。",
      render: () => <SourceExample />,
    },
    {
      id: "empty",
      name: "空源码",
      section: "states",
      condition: "消费者传入空内容。",
      steps: ["查看空编辑器并尝试选择文字。"],
      expected: "没有补造内容或旧选区。",
      render: () => <SourceExample empty />,
    },
  ],
  viewport: { width: 780, height: 420 },
} satisfies CatalogEntry
