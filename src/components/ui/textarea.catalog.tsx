import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "textarea",
  name: "多行输入",
  source: "src/components/ui/textarea.tsx",
  group: "输入与表单",
  layer: "基础组件",
  order: 17,
  pages: ["首页"],
  stage: "content",
  description: "编辑项目指令等普通多行字段。",
  boundary: "不同于Lexical正文编辑；不插入文件节点或Skill调用。",
  standards: [
    {
      id: "T1",
      name: "长内容局部滚动",
      rule: "长内容在正文区域滚动，不撑出弹窗动作区；保留换行。",
      reason: "编辑空间和操作可达需要同时满足。",
      check: "输入多行与长文本；Tab仍可达取消和保存。",
    },
    {
      id: "T2",
      name: "字段反馈",
      rule: "标签、说明和错误同属Field；输入保留，不添加悬浮说明替代错误。",
      reason: "多行字段仍遵守表单关联规则。",
      check: "聚焦无效字段并检查关联说明。",
    },
  ],
  inputs: [
    "value / onChange / rows / disabled",
    "aria-invalid 与 FieldError 关联；最大高度与局部滚动由页面设置",
  ],
  events: ["onChange 保留换行；页面控制保存和取消"],
  composition: [
    "直接复用 src/components/ui/textarea.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["输入两行指令，保留换行。", "用键盘编辑并Tab离开。"],
      expected: "换行保留，值不自动修剪，字段关联清楚。",
      render: () => <BasicControlExample kind="textarea" mode="normal" />,
    },
    {
      id: "invalid",
      name: "无效输入",
      section: "exception",
      condition: "通过参数给出对应状态，示例不调用真实后端。",
      steps: ["查看无效边界及字段错误关联。", "输入并检查原值可编辑。"],
      expected:
        "错误文字就近可读并关联控件，不清空输入；本例校验状态由调用方指定。",
      render: () => <BasicControlExample kind="textarea" mode="invalid" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="textarea" mode="disabled" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "输入两行指令，保留换行。",
        "用键盘编辑并Tab离开。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="textarea" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
