import type { CatalogEntry } from "../../ui-catalog/catalog"
import { useTheme } from "@/components/theme-provider"
import { CatalogHeader } from "./catalog-header"
import "../catalog.css"

function HeaderPreview() {
  const { theme, setTheme } = useTheme()
  return (
    <CatalogHeader
      environment="组件展示 · 不连接真实服务"
      theme={theme}
      onThemeChange={setTheme}
      onOpenNavigation={() => undefined}
    />
  )
}

export default {
  id: "api-catalog-header",
  name: "接口目录页头",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/catalog-header.tsx",
  description:
    "标识接口目录，提供环境提示、独立外观切换、窄屏导航和返回应用入口。",
  boundary: "不持有业务请求；theme 由调用方管理，目录主题与正式应用隔离。",
  inputs: ["environment", "theme", "onThemeChange", "onOpenNavigation"],
  events: ["更改外观", "打开导航", "返回 Moon"],
  composition: ["Button", "ThemeMenu（首次打开后加载）", "Lucide"],
  consumers: ["ApiCatalogApp"],
  viewport: { width: 1000, height: 220 },
  states: [
    {
      id: "desktop",
      name: "桌面",
      condition: "宽窗口",
      expected: "环境与次动作同一页头，主题可切换。",
      render: () => <HeaderPreview />,
    },
    {
      id: "compact",
      name: "窄屏导航",
      condition: "将预览视口调整至 320px",
      expected: "显示导航按钮，不挤压页头或产生横向溢出。",
      render: () => <HeaderPreview />,
    },
  ],
} satisfies CatalogEntry
