import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomePage } from "./home-page"
import { homeData, submitMockWork } from "../../../ui-catalog/fixtures/home"
export default {
  id: "home-page",
  name: "Moon 首页",
  layer: "页面",
  group: "工作空间",
  source: "src/features/home/home-page.tsx",
  description: "编排侧栏、工作输入区和范围提示；保持原首页的信息层次。",
  boundary:
    "只包含首页；外部入口提示尚未实现，所有提交是模拟。业务数据和提交函数由 App 注入。需要 ThemeProvider。",
  inputs: [
    "data: HomeData，首页所有业务选项及会话。",
    "onSubmit: SubmitWork，传递给 HomeComposer。",
  ],
  events: [
    "新建会话重建草稿；桌面侧栏折叠为 56px 图标列，宽度可在 240–360px 调整，Ctrl+B 折叠、Ctrl+K 搜索；窄屏打开导航弹窗，Escape 关闭。",
  ],
  composition: [
    "HomeSidebar、HomeComposer、ConversationSearch、Dialog、Button",
  ],
  consumers: ["App"],
  viewport: { width: 1280, height: 800 },
  states: [
    {
      id: "default",
      name: "默认首页",
      condition: "完整模拟数据。",
      expected:
        "输入与发送、搜索、菜单、材料及重置均可操作；宽度小于 768px 使用抽屉导航。",
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
