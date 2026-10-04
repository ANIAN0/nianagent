import { useState } from "react"
import { MaterialChip } from "./material-chip"
import type { Material } from "./home-types"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  material,
  retry = false,
}: {
  material: Material
  retry?: boolean
}) {
  const [removed, setRemoved] = useState(false)
  const [current, setCurrent] = useState(material)
  return (
    <div className="p-6">
      {removed ? (
        <p role="status">已移除：{material.id}</p>
      ) : (
        <MaterialChip
          material={current}
          onRemove={() => setRemoved(true)}
          onRetry={
            retry
              ? () =>
                  setCurrent((item) => ({
                    ...item,
                    status: "ready",
                    error: undefined,
                  }))
              : undefined
          }
        />
      )}
    </div>
  )
}
export default {
  id: "material-chip",
  name: "材料条目",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/material-chip.tsx",
  description:
    "文件卡、蓝色Skill标签或64px图片，表达准备、失败、逐项恢复、预览及移除。",
  boundary: "仅表达单个已选材料；集合去重与移除由调用方处理。",
  props: [
    {
      name: "material",
      type: "Material",
      default: "必填",
      description: "id、name、kind（附件或 Skill）。",
    },
    {
      name: "onRemove",
      type: "(id: string) => void",
      default: "必填",
      description: "只通知移除目标，不修改数据。",
    },
    {
      name: "onRetry",
      type: "(id: string) => void",
      default: "可选",
      description: "失败时提供明确恢复动作；能力不兼容或不能重放的来源不传入。",
    },
    {
      name: "retryLabel",
      type: "string",
      default: "重新检查",
      description: "由控制器区分已有引用重新核对和临时准备重试。",
    },
  ],
  inputs: ["material: Material"],
  events: ["onRemove(id)", "onRetry(id)", "onPreview(material)"],
  composition: [
    "Attachment、AttachmentMedia、AttachmentContent、AttachmentTrigger、AttachmentActions/AttachmentAction",
  ],
  consumers: ["SelectedMaterials"],
  viewport: { width: 340, height: 160 },
  states: [
    {
      id: "preparing",
      name: "材料准备中",
      condition: "读取图片或来源",
      expected: "逐项显示准备中并仍可移除",
      render: () => (
        <Example
          material={{
            id: "preparing",
            name: "设计稿.png",
            kind: "附件",
            type: "image",
            status: "preparing",
            source: "H:/工作区/moon/设计稿.png",
          }}
        />
      ),
    },
    {
      id: "failed",
      name: "来源失效",
      condition: "恢复失败",
      expected: "保留名称及具体原因，移除不删除源文件",
      render: () => (
        <Example
          material={{
            id: "failed",
            name: "验收说明.md",
            kind: "附件",
            type: "file",
            status: "failed",
            source: "H:/工作区/moon/验收说明.md",
            error: "引用来源已不存在，请重新选择或移除。",
          }}
        />
      ),
    },
    {
      id: "retry",
      name: "可重新检查",
      condition: "来源恢复后允许单项核对",
      expected: "条目直接说明重新检查；点击保留ID并转为可用，移除仍独立。",
      render: () => (
        <Example
          retry
          material={{
            id: "retry-file",
            name: "验收说明.md",
            kind: "附件",
            type: "file",
            status: "failed",
            error: "目录暂时不可读。",
          }}
        />
      ),
    },
    {
      id: "image",
      name: "64px图片",
      condition: "正式预览缓存已准备",
      expected: "图片使用纵向64px缩略图，移除始终可达，名称/来源可读。",
      render: () => (
        <Example
          material={{
            id: "image",
            name: "设计稿.png",
            kind: "附件",
            type: "image",
            status: "ready",
            thumbnail: "/moon.svg",
            source: "H:/工作区/moon/设计稿.png",
          }}
        />
      ),
    },
    {
      id: "file",
      name: "附件",
      condition: "一个文件材料。",
      expected: "文件图标与名称可见，移除反馈目标 ID。",
      render: () => (
        <Example material={{ id: "readme", name: "README.md", kind: "附件" }} />
      ),
    },
    {
      id: "skill",
      name: "Skill",
      condition: "一个能力材料。",
      expected: "蓝色 /名称 标签表达Skill引用，预览与移除保持独立。",
      render: () => (
        <Example material={{ id: "review", name: "代码审查", kind: "Skill" }} />
      ),
    },
    {
      id: "root-file",
      name: "根目录文件",
      condition: "相对来源与文件名相同。",
      expected: "第二行显示文件引用而非重复名称，完整路径仍保留。",
      render: () => (
        <Example
          material={{
            id: "root-file",
            name: "README.md",
            type: "file",
            kind: "附件",
            status: "ready",
            description: "README.md",
            source: "H:/workspace/moon/README.md",
          }}
        />
      ),
    },
    {
      id: "nested-file",
      name: "子目录文件",
      condition: "材料描述是工作目录相对路径。",
      expected: "名称与父目录分开呈现，不重复文件名。",
      render: () => (
        <Example
          material={{
            id: "nested-file",
            name: "App.tsx",
            type: "file",
            kind: "附件",
            status: "ready",
            description: "src/App.tsx",
            source: "H:/workspace/moon/src/App.tsx",
          }}
        />
      ),
    },
    {
      id: "long",
      name: "长名称",
      condition: "超过可用宽度。",
      expected: "截断但移除始终可见，悬停名称显示完整文本。",
      render: () => (
        <Example
          material={{
            id: "long",
            name: "首页交互与组件边界审查记录以及后续修订说明.md",
            kind: "附件",
          }}
        />
      ),
    },
  ],
} satisfies CatalogEntry
