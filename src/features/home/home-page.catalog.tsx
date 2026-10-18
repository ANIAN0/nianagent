import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomePageExample } from "../../../ui-catalog/fixtures/home-page-stories"

export default {
  id: "home-page",
  name: "首页与工作台",
  layer: "页面",
  stage: "content",
  order: 1,
  pages: ["首页"],
  group: "工作台",
  source: "src/features/home/app-shell.tsx",
  description:
    "从工作台导航选择目录、浏览历史，在完整首页组合中准备并提交新请求；设置与插件入口使用已有隔离演示。",
  boundary:
    "直接组合正式 AppShell 与 HomeComposer，复用原场景的 Provider 和隔离服务。输入提交止于原首页场景的接收回调，不连接真实模型；打开历史使用已登记的完整会话示例，不能证明真实首页到宿主运行已验收。",
  story: {
    goal: "从完整工作台开始，在所选目录提出新请求并进入相关功能。",
    preconditions: [
      "演示提供内存工作区、模型、权限与材料服务。",
      "不需要用户的真实模型凭据或会话数据。",
    ],
    result:
      "目录、导航和输入共同可用，原输入和隔离提交结果可核对，设置或历史可返回首页。",
  },
  modules: [
    { id: "app-shell", region: "左侧导航与账户菜单" },
    { id: "home-composer", region: "首页中央的完整输入区" },
  ],
  standards: [
    {
      id: "complete-workspace",
      name: "导航与输入共同组成首页",
      rule: "完整首页同时保留工作台导航和正式输入组合；在详情中的视口变化不能用删去导航或输入入口来适配。底层输入规则继续引用首页输入区的唯一登记。",
      reason: "读者需要在真实空间中理解导航、目录和新请求的关系。",
      check:
        "从首页选择目录并提交，打开历史后新建返回，进入设置后返回；分别核对宽屏和窄窗中的导航与输入入口。",
    },
  ],
  inputs: [
    "AppShell 的工作区与会话数据来自同一首页隔离环境；子区的服务与输入行为仍由 HomeStoryExample 持有。",
  ],
  events: [
    "新建返回空白首页；选择历史打开完整会话示例；设置和插件进入相应正式组合的隔离示例。",
    "首页发送复用原 HomeComposer 回调，在演示环境中显示收到的正文和材料，不创建真实会话。",
  ],
  composition: [
    "AppShell · src/features/home/app-shell.tsx",
    "HomeComposer · src/features/home/home-composer.tsx",
  ],
  consumers: ["App · src/App.tsx"],
  viewport: { width: 1280, height: 800 },
  states: [
    {
      id: "home-ready",
      name: "从首页开始工作",
      section: "normal",
      condition: "工作台打开，已有隔离工作区和历史，输入为空。",
      expected:
        "导航与完整输入同时可用；提交结果留在隔离演示中，离开与返回可继续操作。",
      steps: [
        "在中央输入任务，选择模型或会话配置，发送后展开演示环境查看接收内容。",
        "从左侧打开历史，再点新建回到首页。",
        "从账户菜单进入设置并返回；插件入口打开隔离插件管理，返回继续输入。",
      ],
      render: () => <HomePageExample />,
    },
    {
      id: "home-missing-workspace",
      name: "补齐工作目录后输入",
      section: "exception",
      condition: "首页尚未登记工作区，正式输入区说明当前前置条件。",
      expected: "添加演示目录后完整输入恢复；侧栏与正文保持同一页面布局。",
      steps: [
        "查看输入区的目录入口并添加演示目录。",
        "输入新请求并发送，确认隔离演示收到内容。",
      ],
      render: () => <HomePageExample scenario="workspace-empty" />,
    },
  ],
} satisfies CatalogEntry
