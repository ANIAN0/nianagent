import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomePage } from "./home-page"
import { homeData, submitMockWork } from "../../../ui-catalog/fixtures/home"
export default {
  id: "home-page",
  name: "Moon 首页",
  layer: "页面",
  group: "工作空间",
  source: "src/features/home/home-page.tsx",
  description:
    "供组件库独立展示首页布局的组合包装，复用正式应用布局和输入组件。",
  boundary:
    "此包装只用于首页独立展示，data与onSubmit由展示调用方注入；本目录状态使用模拟提交，不读取真实会话、不调用模型。正式入口由App直接组合AppShell和HomeComposer并连接真实服务。需要ThemeProvider。",
  inputs: [
    "data: HomeData，首页所有业务选项及会话。",
    "onSubmit: SubmitWork，传递给 HomeComposer。",
  ],
  events: [
    "新建会话重建展示草稿；侧栏与搜索只演示选项，不进入真实对话；桌面侧栏折叠为56px图标列，宽度可在240–360px调整，Ctrl+B折叠、Ctrl+K搜索；窄屏打开导航弹窗，Escape关闭。",
  ],
  composition: ["AppShell、HomeComposer"],
  consumers: ["home-page.catalog.tsx（独立首页展示）"],
  viewport: { width: 1280, height: 800 },
  states: [
    {
      id: "default",
      name: "默认首页",
      condition: "完整模拟数据。",
      expected:
        "输入、模拟发送、搜索和菜单可操作；材料能力仅在此演示。历史选项不进入正式对话，宽度小于768px使用抽屉导航。",
      render: () => <HomePage data={homeData} onSubmit={submitMockWork} />,
    },
    {
      id: "no-history",
      name: "无历史会话",
      condition: "目录和模型存在，历史会话为空。",
      expected: "侧栏显示空状态，输入区仍能提交。",
      render: () => (
        <HomePage
          data={{ ...homeData, conversations: [] }}
          onSubmit={submitMockWork}
        />
      ),
    },
  ],
} satisfies CatalogEntry
