import type { CatalogEntry } from "../../../catalog-types.ts"
import { WorkbenchExample } from "../../../plugins/file-workbench/workbench.catalog"

export default {
  id: "plugin-sidebar",
  name: "会话右侧栏",
  layer: "复合组件",
  stage: "content",
  order: 102,
  pages: ["会话"],
  group: "会话",
  source: "src/features/plugins/plugin-sidebar.tsx",
  description:
    "正式会话壳、插件宿主、文件内容与 Pi 交互的完整组合。收起不占宽度，顶部标签负责切换和关闭，加号打开临时入口页，选择后替换该页。",
  boundary:
    "直接使用正式 PluginSessionWorkspace、PluginSidebar、LiveConversationView、ConversationComposer 及文件插件；仅注入隔离注册表、文件服务与请求回复，不访问真实文件或模型。",
  story: {
    goal: "在会话中打开插件内容，保留阅读和输入状态，并明确返回会话。",
    preconditions: ["已打开会话，插件已注册右侧标签，或有待处理的 Pi 交互。"],
    result: "标签、关闭、收起和窄窗返回由宿主管理，插件只提供内容。",
  },
  inputs: [
    "sessionId / active / registry / snapshot",
    "PluginSidebarLayout / PluginSidebarEntry[]",
    "隔离文件服务和回复服务",
  ],
  events: [
    "打开、切换、关闭标签；收起和恢复面板",
    "调整栏宽；全屏与还原；Escape 返回会话",
    "插件输入、停用和重新启用",
  ],
  composition: [
    "PluginSessionWorkspace / PluginSidebar / LiveConversationView / ConversationComposer / PromptInput",
    "Tabs / Resizable / Button",
    "FileDirectory / FilePanel / FileChanges / PluginDeliveryList / PluginInteractionRequest",
  ],
  consumers: ["App → PluginSessionHost → LiveConversationView"],
  standards: [
    {
      id: "sidebar-layout",
      name: "会话优先",
      rule: "收起后不保留入口列。会话标题右端的宿主按钮恢复右栏；只有一个入口时直接打开，多入口先展示插件入口页。",
      reason: "沿 DSH 减少辅助功能常驻占位。",
      check: "从收起状态打开，再收起，消息与输入草稿保持。",
    },
    {
      id: "sidebar-tabs",
      name: "标签生命周期",
      rule: "重复打开保留顺序和参数；标签旁关闭该页并选择相邻页；收起保留标签与已挂载内容；插件停用移除自己的入口与内容。临时加载失败保留标签身份及顺序，重新加载后恢复内容；打开、保存和恢复使用同一数量规则，不因超过64个标签清空布局。",
      reason: "区分切换、关闭内容与收起容器。",
      check: "打开目录、两个文件和插件交互；切换、收起、恢复，再关闭一个标签。",
    },
    {
      id: "sidebar-responsive",
      name: "有限空间",
      rule: "会话可用宽度不足768px时，右栏在同一内容树上全屏呈现；保留返回会话、Escape、焦点循环和菜单操作；插件不自行覆盖主区。",
      reason: "保证内容可读与操作可达。",
      check: "窄窗打开文件、打开入口页、返回会话；再加宽恢复并排显示。",
    },
  ],
  viewport: { width: 1000, height: 760 },
  states: [
    {
      id: "initial-module-failure",
      name: "首次加载失败与重试",
      section: "exception",
      condition: "插件已启用，但前端首次加载失败，尚未打开任何标签。",
      expected:
        "入口页显示所属插件错误和重试；恢复后出现真实入口，文件可正常打开。",
      steps: [
        "打开右侧栏，查看错误。",
        "点击重新加载插件，再从文件入口打开README.md。",
      ],
      render: () => <WorkbenchExample initialModuleFailure />,
    },
    {
      id: "delivery-generation-recovery",
      name: "交付组件代次恢复",
      section: "exception",
      condition: "第一代交付组件渲染失败，历史记录显示摘要。",
      expected: "更新代次后恢复正式交付卡，能够打开文件，不需要刷新页面。",
      steps: [
        "查看交付摘要回退。",
        "在示例控制更新插件代次，再从恢复的交付卡打开文件。",
      ],
      render: () => <WorkbenchExample deliveryRecovery />,
    },
    {
      id: "module-recovery",
      name: "插件资源加载恢复",
      section: "exception",
      condition: "插件保持启用，资源加载临时失败。",
      expected:
        "原标签和选中项保留，显示失败反馈；重新加载后在原标签恢复内容。",
      steps: [
        "打开README.md和source.ts。",
        "在示例控制中模拟插件资源加载失败。",
        "点击标签内的重新加载插件，确认两个标签及选中项恢复。",
      ],
      render: () => <WorkbenchExample moduleRecovery />,
    },
    {
      id: "default",
      name: "收起与文件阅读",
      section: "normal",
      condition:
        "文件插件提供目录和变更入口，预览从交付卡或目录打开，右栏初始收起。",
      expected: "从宿主按钮或交付卡打开文件，拖动宽度、收起与恢复后继续阅读。",
      steps: [
        "点击右上角打开右侧栏。",
        "从交付卡打开README.md，阅读并引用选区。",
        "拖动栏宽，收起后再次打开。",
      ],
      render: () => <WorkbenchExample />,
    },
    {
      id: "multiple",
      name: "多标签与插件输入",
      section: "normal",
      condition: "文件插件同时有业务标签和待回复的Pi输入。",
      expected:
        "目录、文件预览、变更和交互共用宿主标签；选择入口后临时入口页消失，切换保留未提交输入。",
      steps: [
        "打开右栏，选择交互入口并输入文字。",
        "点击加号进入入口页，选择目录后打开文件，再切回交互。",
        "关闭文件，再回复交互请求。",
      ],
      render: () => <WorkbenchExample interaction />,
    },
    {
      id: "read-failure",
      name: "文件读取失败与恢复",
      section: "exception",
      condition: "隔离文件服务首次读取失败。",
      expected: "失败保留会话和右栏入口，恢复服务后能重新打开文件，不丢草稿。",
      steps: [
        "从交付卡打开文件并查看所属错误。",
        "在示例控制中恢复读取，再打开同一文件。",
      ],
      render: () => <WorkbenchExample failure />,
    },
    {
      id: "narrow",
      name: "窄窗返回会话",
      section: "states",
      condition: "正式宿主可用宽度520px。",
      expected:
        "打开后填满当前会话区域，操作栏可达；Escape或返回按钮恢复会话和草稿。",
      steps: [
        "在消息输入中写下一稿，再打开文件。",
        "操作入口页与标签，按Escape返回会话。",
      ],
      render: () => <WorkbenchExample compact interaction />,
    },
    {
      id: "lifecycle",
      name: "停用与恢复",
      section: "states",
      condition: "从示例控制切换插件启用状态。",
      expected:
        "停用时移除入口与内容；重新启用不会复活已移除的标签；历史交付仍有可读摘要。",
      steps: [
        "打开文件和交互。",
        "展开示例控制并停用插件。",
        "重新启用，通过宿主入口重新打开。",
      ],
      render: () => <WorkbenchExample interaction />,
    },
  ],
} satisfies CatalogEntry
