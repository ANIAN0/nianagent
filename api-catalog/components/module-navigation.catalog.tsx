import type { CatalogEntry } from "../../ui-catalog/catalog"
import { useState } from "react"
import { ModuleNavigation } from "./module-navigation"
import type { ModelOperation, NavigationItem } from "./types"
import "../catalog.css"

const previewItems: NavigationItem[] = [
  { id: "list", title: "连接目录", module: "模型配置" },
  { id: "providers", title: "Pi 提供者目录", module: "模型配置" },
  { id: "sessionRead", title: "读取会话生效配置", module: "会话配置" },
  { id: "sessionApply", title: "应用会话配置", module: "会话配置" },
]

function NavigationPreview({
  initialQuery = "",
  moduleSelected = false,
}: {
  initialQuery?: string
  moduleSelected?: boolean
}) {
  const [query, setQuery] = useState(initialQuery)
  const [selected, setSelected] = useState<ModelOperation | undefined>(
    moduleSelected ? undefined : "sessionRead"
  )
  const [selectedModule, setSelectedModule] = useState<string | undefined>(
    moduleSelected ? "会话配置" : undefined
  )
  return (
    <div className="api-catalog-navigation-preview">
      <ModuleNavigation
        items={previewItems}
        query={query}
        onQueryChange={setQuery}
        selected={selected}
        selectedModule={selectedModule}
        onSelect={(id) => {
          setSelected(id)
          setSelectedModule(undefined)
        }}
        onModuleSelect={(module) => {
          setSelectedModule(module)
          setSelected(undefined)
        }}
      />
    </div>
  )
}

export default {
  id: "api-module-navigation",
  name: "接口模块导航",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/module-navigation.tsx",
  description: "按契约模块浏览接口，用名称、调用标识或模块搜索并定位。",
  boundary: "输入仅来自契约导航元数据；选择发出事件，不自动调用后端。",
  inputs: ["items", "selected", "selectedModule", "query"],
  events: [
    "onSelect",
    "onQueryChange",
    "onModuleSelect",
    "方向键和 Home/End 定位",
  ],
  composition: ["InputGroup", "Button", "Empty", "稳定 operation 链接"],
  consumers: ["ApiCatalogApp", "窄屏导航 Dialog"],
  viewport: { width: 360, height: 640 },
  states: [
    {
      id: "selected",
      name: "当前接口",
      condition: "读取会话配置已选中",
      expected: "持久选中与焦点分别表达，↑↓与 Enter 可定位。",
      render: () => <NavigationPreview />,
    },
    {
      id: "search",
      name: "搜索匹配",
      condition: "搜索 session",
      expected: "只显示匹配分组和数量，清除搜索恢复所有接口。",
      render: () => <NavigationPreview initialQuery="session" />,
    },
    {
      id: "no-results",
      name: "无匹配",
      condition: "不存在的搜索",
      expected: "明确空状态，清除后焦点返回搜索框。",
      render: () => <NavigationPreview initialQuery="不存在的接口" />,
    },
    {
      id: "module",
      name: "模块说明",
      condition: "会话配置模块选中",
      expected: "模块选中与具体接口选中互斥。",
      render: () => <NavigationPreview moduleSelected />,
    },
  ],
} satisfies CatalogEntry
