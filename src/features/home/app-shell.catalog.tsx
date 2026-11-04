import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import type { ComposerData } from "@/lib/composer/types"
import { AppShell } from "./app-shell"

const navigationData: ComposerData = {
  workspaces: [
    {
      id: "navigation-example",
      name: "长历史工作区",
      path: "H:/example/navigation-workspace",
    },
  ],
  conversations: Array.from({ length: 32 }, (_, index) => ({
    id: `navigation-example-${index}`,
    workspaceId: "navigation-example",
    title: `长历史标题用于核对抽屉边界 ${"LongConversationTitle".repeat(5)}`,
    status:
      index === 1
        ? "completed"
        : index === 2
          ? "running"
          : index === 7
            ? "waiting"
            : index === 11
              ? "failed"
              : "idle",
    unread: index === 1,
  })),
  models: [],
  materials: [],
  tools: [],
}

function NavigationExample({
  long = false,
  failure = false,
}: { long?: boolean; failure?: boolean } = {}) {
  const [event, setEvent] = useState("")
  const [unavailable, setUnavailable] = useState(failure)
  const data = long
    ? navigationData
    : {
        ...navigationData,
        conversations: navigationData.conversations
          .slice(0, 3)
          .map((item, index) => ({ ...item, title: `隔离会话 ${index + 1}` })),
      }
  return (
    <AppShell
      data={data}
      activeConversationId="navigation-example-0"
      historyState={unavailable ? "error" : "ready"}
      historyError={unavailable ? "示例：历史暂不可读；保留已显示记录。" : ""}
      onHistoryRetry={() => {
        setUnavailable(false)
        setEvent("隔离历史读取已恢复。")
      }}
      onNew={() => setEvent("预览触发新建，未创建真实会话。")}
      onSelectConversation={() => setEvent("预览选择历史，未读取真实会话。")}
      onSettings={() => setEvent("已从账户菜单到达隔离设置入口。")}
      onPlugins={() => setEvent("预览到达插件入口，未更改真实插件。")}
    >
      <div className="p-16">
        <h1>工作台导航组合</h1>
        <p role="status">
          {event || "打开导航，滚动长历史，并从底部账户菜单进入设置。"}
        </p>
      </div>
    </AppShell>
  )
}

export default {
  id: "app-shell",
  name: "会话左侧栏",
  source: "src/features/home/app-shell.tsx",
  group: "会话",
  layer: "复合组件",
  order: 101,
  pages: ["首页", "会话", "设置"],
  stage: "content",
  description: "正式AppShell、HomeSidebar及历史列表的有界导航组合。",
  boundary:
    "长历史仅为目录内存数据，导航止于隔离回调；不读取用户历史，不创建会话或调用宿主。",
  story: {
    goal: "在窄窗长历史下打开导航并从底部账户菜单到达设置。",
    preconditions: ["正式导航组件和预览主题、Tooltip环境就绪。"],
    result:
      "历史在自己的容器内滚动，标题不撑宽抽屉，页首导航与底部账户可操作。",
  },
  standards: [
    {
      id: "N1",
      name: "导航容器边界",
      rule: "768px以下使用有界抽屉；768–1023px默认收起为导航轨道，仍可手动展开；1024px起恢复宽窗开关偏好。侧栏宽度在240–360px间调整并记忆，默认280px。长标题截断，历史独立滚动，底部账户留在抽屉内。",
      reason: "长历史不能让用户失去设置入口。",
      check:
        "390×760打开导航，滚动到末尾，点击账户再点设置；1100px宽度核对原侧栏及账户。",
    },
  ],
  inputs: ["AppShell正式data与导航回调；预览仅提供隔离历史。"],
  events: ["导航开关和滚动由正式组件处理；设置、选择与新建回调只写预览反馈。"],
  composition: [
    "AppShell / HomeSidebar / PrimaryNavigation / ConversationHistory / ConversationGroup / ConversationItem / UserMenu / Dialog",
  ],
  consumers: ["正式首页、会话与设置工作台"],
  states: [
    {
      id: "navigation",
      name: "打开导航并进入设置",
      section: "normal",
      condition: "正式AppShell从导航关闭起点显示三条隔离会话。",
      steps: ["打开导航并点击底部本地用户。", "选择设置并读取隔离入口反馈。"],
      expected: "账户菜单可达，选择设置关闭抽屉并到达隔离回调。",
      render: () => <NavigationExample />,
    },
    {
      id: "history-unavailable",
      name: "历史读取失败仍可导航",
      section: "exception",
      condition: "隔离历史读取失败，已有长历史保持；正式反馈提供重读入口。",
      steps: [
        "打开导航，核对历史读取失败反馈与账户入口。",
        "点击重读历史，核对读取恢复后仍可进入设置。",
      ],
      expected: "历史错误不挤出导航和账户；恢复仅改变隔离读取状态。",
      render: () => <NavigationExample long failure />,
    },
    {
      id: "long-history",
      name: "窄窗长历史与底部设置入口",
      section: "states",
      condition: "正式AppShell从导航关闭起点加载32条带长标题的隔离历史。",
      steps: [
        "在390×760视口点击打开导航，核对标题、抽屉边界和底部账户。",
        "在历史区域滚动到底，再点击本地用户并选择设置。",
        "重置并将视口宽度改为1100，核对桌面侧栏、收起/展开及账户入口。",
      ],
      expected:
        "长历史局部滚动，账户可见可点，选择设置关闭抽屉并回显隔离入口；不改变真实用户数据。",
      render: () => <NavigationExample long />,
    },
  ],
  viewport: { width: 390, height: 760 },
} satisfies CatalogEntry
