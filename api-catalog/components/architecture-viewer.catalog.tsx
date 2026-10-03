import type { CatalogEntry } from "../../ui-catalog/catalog"
import { ArchitectureViewer } from "./architecture-viewer"
import { CatalogPreview } from "./catalog-fixtures"
import architecture from "../../ARCHITECTURE.md?raw"

export default {
  id: "api-architecture-viewer",
  name: "模块架构说明",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/architecture-viewer.tsx",
  description:
    "定位原 ARCHITECTURE.md 的模块章节，按需查看全文而不复制模块正文。",
  boundary: "只读原文；章节匹配由源标题决定，未匹配明确告知。",
  inputs: ["content", "module", "sectionTitle", "focusOnMount"],
  events: ["当前模块/全文切换", "复制说明"],
  composition: ["Tabs", "Empty", "CopyButton"],
  consumers: ["ArchitecturePanel"],
  viewport: { width: 900, height: 800 },
  states: [
    {
      id: "module",
      name: "模块章节",
      condition: "会话配置章节存在",
      expected: "只展示原文对应模块，全文可另行切换查看。",
      render: () => (
        <CatalogPreview>
          <ArchitectureViewer
            content={architecture}
            module="会话配置"
            sectionTitle="会话配置模块"
          />
        </CatalogPreview>
      ),
    },
    {
      id: "missing",
      name: "章节未匹配",
      condition: "无同名章节",
      expected: "不伪造架构内容，明确提示并可查看原全文。",
      render: () => (
        <CatalogPreview>
          <ArchitectureViewer content={architecture} module="尚无说明的模块" />
        </CatalogPreview>
      ),
    },
  ],
} satisfies CatalogEntry
