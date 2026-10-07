import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "input",
  name: "输入框",
  source: "src/components/ui/input.tsx",
  group: "输入与表单",
  layer: "基础组件",
  order: 15,
  pages: ["首页"],
  stage: "content",
  description: "承载搜索词或单行配置字段。",
  boundary: "普通Input不承担首页富编辑或材料引用身份；这些由PromptInput负责。",
  standards: [
    {
      id: "I1",
      name: "字段尺寸",
      rule: "单行输入32px高、8px圆角；default保留窄窗16px及md以上14px，compact在所有视口使用14px/20px。焦点边界和外环沿共享token。",
      reason: "输入框与来源Select需要稳定的共同对齐轴。",
      check: "对比默认、键盘聚焦和禁用；长值在控件内滚动。",
    },
    {
      id: "I2",
      name: "错误可定位",
      rule: "错误边界与就近可读说明同时出现，并关联控件。",
      reason: "颜色不能单独解释错误或告诉用户怎样恢复。",
      check: "读到错误对象和恢复要求，输入不因错误被清空。",
    },
  ],
  inputs: [
    "value / onChange / placeholder / disabled",
    "variant: default | compact；未传入时保持default",
    "aria-invalid 与 aria-describedby 指向 FieldError",
  ],
  events: ["onChange 传递原始输入；过滤和保存由父级决定"],
  composition: [
    "直接复用 src/components/ui/input.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["输入关键词，选择并替换一段文字。", "Tab离开后重新聚焦。"],
      expected: "值完整可编辑，焦点与默认边界一致。",
      render: () => <BasicControlExample kind="input" mode="normal" />,
    },
    {
      id: "compact",
      name: "紧凑筛选字段",
      section: "states",
      condition: "显式variant=compact，用于32px筛选栏；默认规格不变。",
      steps: ["在390px与常规视口输入搜索词。", "检查14px/20px文字与32px高度、聚焦和选择文字。"],
      expected: "紧凑字号在不同视口保持一致，输入行为与default相同。",
      render: () => <BasicControlExample kind="input" mode="compact" />,
    },
    {
      id: "invalid",
      name: "无效输入",
      section: "exception",
      condition: "通过参数给出对应状态，示例不调用真实后端。",
      steps: ["查看无效边界及字段错误关联。", "输入并检查原值可编辑。"],
      expected:
        "错误文字就近可读并关联控件，不清空输入；本例校验状态由调用方指定。",
      render: () => <BasicControlExample kind="input" mode="invalid" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="input" mode="disabled" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "输入关键词，选择并替换一段文字。",
        "Tab离开后重新聚焦。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="input" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
