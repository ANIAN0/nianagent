import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "home-composer",
  name: "首页输入区",
  source: "src/features/home/home-composer.tsx",
  group: "首页",
  layer: "页面",
  order: 200,
  pages: ["首页"],
  stage: "content",
  description:
    "在同一完整输入区检查目录、材料、权限、模型、会话配置与发送的组合。",
  boundary:
    "复用正式HomeComposer，只包含首页输入区；不复制侧栏，不进入对话、消息队列或审批。所有边界与存储在预览内存，发送止于首页回调。",
  story: {
    goal: "把这条请求的目录、内容、材料和执行上下文完整地组合并提交。",
    preconditions: [
      "八个故事的独立标准均适用。",
      "演示不依赖桌面宿主或有效模型凭据。",
    ],
    result:
      "各入口同屏无冲突；文字与材料提交归属正确；等待、错误、窄窗仍能继续任务。",
  },
  standards: [
    {
      id: "T1",
      name: "正文与布局",
      rule: "输入卡20px圆角，正文与工具栏12px间隔；正文最大336px并随视口收缩，长文局部滚动，发送始终可达。",
      reason: "用户任务是输入与发送；提示和长内容不能挤掉工具栏。",
      check: "短文、长文和390px视口核对焦点、滚动、工具栏。",
    },
    {
      id: "T2",
      name: "占位与输入语义",
      rule: "占位为“描述你想完成的工作，/ 选择命令或 Skill，@ 引用文件”；占位不进入数据。IME期间不误发送；Shift+Enter换行，Enter按候选/提交上下文处理。",
      reason: "占位说明可用动作，不能成为默认消息或静态提示行。",
      check: "输入、换行、清空、候选开启与普通发送分别核对。",
    },
    {
      id: "U1",
      name: "同级入口",
      rule: "权限、模型和会话配置统一28px高、13px/20px、400字重、胶囊形状、左右8px/内部6px；权限在左，模型和会话配置在右。",
      reason:
        "同一工具栏的执行上下文选择必须有一致层级；位置延续用户已确认的权限区域。",
      check:
        "完整输入区及窄窗一起检查默认、悬停、展开、焦点和禁用；不能仅看孤立按钮。",
    },
    {
      id: "H4",
      name: "组合必须经过主流程",
      rule: "默认例包含权限服务、真实材料准备、配置读取和完整工具栏；不能用删掉入口、预置ready材料或缩短正文避开布局和身份故障。",
      reason:
        "组件页是明确标准与暴露差异的依据，孤立控件无法证明完整输入可用。",
      check:
        "实际完成Skill选择与继续编辑、文件选择与继续编辑、附件预览，分别核对身份与布局；预置完成状态不能代替流程验证。",
    },
  ],
  inputs: [
    "HomeComposerProps：data、initialDraft、draftStore、onSubmit、目录选择/恢复回调",
    "所有依赖由Provider注入，复用正式组件和共享样式",
  ],
  events: [
    "目录/权限/模型/配置分别更新所属草稿；材料使用权威身份",
    "Home onSubmit副本固定，组件页记录服务调用与接收数据",
  ],
  composition: [
    "HomeComposer / WorkspacePicker / PromptInput / SelectedMaterials / ComposerToolbar",
  ],
  consumers: ["首页"],
  states: [
    {
      id: "default",
      name: "完整首页输入区",
      section: "normal",
      condition: "空稿；全部正式输入入口与服务同时存在。",
      steps: [
        "选择目录，输入文字。",
        "打开权限、模型和配置，检查互斥展开与焦点。",
        "实际选择Skill或文件后继续编辑。",
        "添加图片并预览；更换Vision后检查发送。",
      ],
      expected:
        "完整组合符合各故事标准，无遮挡和重复信息；主流程差异不能被演示数据掩盖。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "narrow",
      name: "窄视口与长内容",
      section: "states",
      condition: "预置长文仅检查布局；用视口控件设置390×640。",
      steps: [
        "调整视口到390×640，滚动长正文。",
        "逐一打开权限、模型、配置、加号菜单。",
        "返回正文继续编辑，并检查发送。",
      ],
      expected:
        "正文与浮层局部滚动，三个选择入口和发送均可达，缺失名称能补全。",
      render: () => <HomeStoryExample scenario="text-long" />,
    },
    {
      id: "missing",
      name: "缺少前置条件",
      section: "exception",
      condition: "无工作目录。",
      steps: ["查看目录入口与禁用原因。", "添加演示目录，输入消息并提交。"],
      expected: "前置条件明晰，补齐后恢复整条输入路径；不新增重复常驻提示。",
      render: () => <HomeStoryExample scenario="workspace-empty" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
