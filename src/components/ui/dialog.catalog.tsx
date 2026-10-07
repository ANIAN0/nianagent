import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "dialog",
  name: "弹窗",
  source: "src/components/ui/dialog.tsx",
  group: "浮层与导航",
  layer: "基础组件",
  order: 21,
  pages: ["首页"],
  stage: "content",
  description:
    "默认承载配置任务；reader提供只读阅读分区，image-preview提供独立视口看图层。",
  boundary: "管理焦点和遮罩；候选保存、未保存离开策略由所属业务决定。",
  standards: [
    {
      id: "L1",
      name: "统一表面与分区",
      rule: "通用弹窗12px圆角；标题、正文和底部动作明确分区，正文局部滚动。",
      reason: "弹窗属于同一系统；不能沿用输入卡20px圆角或让动作滚出视口。",
      check: "短窗/长正文仍能看见标题与取消、应用。",
    },
    {
      id: "L2",
      name: "焦点和离开",
      rule: "标题可访问；打开集中焦点；关闭回触发点。业务有未保存约束时明确处理。",
      reason: "弹窗是临时任务，结束后应继续原操作。",
      check: "Tab不进入背景、Esc/取消关闭、焦点回归。",
    },
  ],
  inputs: [
    "open / onOpenChange；Title 必须存在",
    "Content variant: default / reader / image-preview；默认配置表面不变",
    "Body variant: default / document / image-preview / feedback；正文和反馈各有滚动归属",
    "Header / Title / Description / Footer / Close；reader标题路径最多30dvh；image标题可sr-only但不可缺",
  ],
  events: ["关闭/取消不自动保存；应用事件由调用方发出"],
  composition: [
    "直接复用 src/components/ui/dialog.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "image-preview",
      name: "专用看图层",
      section: "normal",
      condition:
        "完整Home空稿，经正式MaterialPreview展示image-preview；隔离服务提供真实PNG。",
      steps: [
        "加号添加附件，沿轨道打开小图标.png、首页设计.png或交付清单.png。",
        "点击图片保留，点击空白/关闭或Escape退出，继续编辑。",
        "在390px、短窗及浅深主题查看自然比例与关闭可达性。",
      ],
      expected:
        "图片独立适配视口，无正文面板；关闭后回正式触发点，默认配置Dialog仍保原外观。",
      render: () => <BasicControlExample kind="dialog" mode="image-preview" />,
    },
    {
      id: "reader",
      name: "文件阅读分区",
      section: "normal",
      condition:
        "完整Home空稿，经正式MaterialPreview展示reader/document；短长文件来自隔离内存。",
      steps: [
        "加号添加附件，打开说明.md，再打开长路径阅读记录。",
        "选择完整路径文字，滚动阅读至文档结束；窄窗分别滚动标题来源和正文。",
        "关闭后继续原稿，核对焦点与材料保留。",
      ],
      expected:
        "完整标题/路径和关闭可达；长文在阅读区滚动，短文不撑满视口，只读原文不被重新解释。",
      render: () => <BasicControlExample kind="dialog" mode="reader" />,
    },
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: [
        "打开会话配置，勾选工具并应用。",
        "再次打开用取消和Escape分别关闭。",
      ],
      expected: "标题可访问，焦点不进入背景，应用有独立事件。",
      render: () => <BasicControlExample kind="dialog" mode="normal" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "打开会话配置，勾选工具并应用。",
        "再次打开用取消和Escape分别关闭。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="dialog" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
