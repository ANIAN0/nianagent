import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { MaterialPreviewDialog } from "./material-preview"
import { MaterialServiceContext } from "./material-service"
import { exampleMaterials, exampleMaterialService } from "./material-catalog-fixtures"
function Example({ index = 0, failed = false }: { index?: number; failed?: boolean }) {
  const [open, setOpen] = useState(false)
  const item = exampleMaterials[index]!
  return <MaterialServiceContext.Provider value={failed ? { ...exampleMaterialService, preview: async () => { throw new Error("文件已移动或不可访问，请重新读取。") } } : exampleMaterialService}><div className="p-6"><Button variant="outline" onClick={() => setOpen(true)}>预览 {item.name}</Button><MaterialPreviewDialog material={open ? item : null} cwd="H:/工作区/moon" onClose={() => setOpen(false)} /></div></MaterialServiceContext.Provider>
}
export default {
  id: "material-preview", name: "材料内容预览", layer: "复合组件", group: "工作输入", source: "src/features/materials/material-preview.tsx",
  description: "当前文件、准备的Skill正文及固定图片使用同一正式预览。",
  boundary: "通过MaterialServiceContext读取；目录注入独立替身，真实页面读取Moon材料服务；不执行文档脚本，不自动重新发送。",
  inputs: ["material/cwd/history；材料身份与来源决定预览对象。"], events: ["onClose；读取失败可重新读取。"], composition: ["Dialog、Alert、Button"], consumers: ["SelectedMaterials、LiveConversationView"], viewport: { width: 900, height: 700 },
  states: [
    { id: "file", name: "当前文件", condition: "普通文件路径引用", expected: "显示当前文件与来源，不称发送时版本", render: () => <Example /> },
    { id: "skill", name: "准备的Skill", condition: "准备过的Skill正文", expected: "正文和来源可核对", render: () => <Example index={1} /> },
    { id: "image", name: "固定图片", condition: "已保存图片内容", expected: "图片保持比例、无重复读取源文件", render: () => <Example index={2} /> },
    { id: "error", name: "来源失效", condition: "服务读取失败", expected: "保留名称来源并就地提供重试", render: () => <Example failed /> },
  ],
} satisfies CatalogEntry
