import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "field",
  name: "表单项",
  source: "src/components/ui/field.tsx",
  group: "输入与表单",
  layer: "基础组件",
  order: 18,
  pages: ["首页"],
  stage: "content",
  description: "组织标签、控件、说明和错误的语义及间距。",
  boundary: "是布局和可访问性组合，不自行校验、加载或保存。",
  standards: [
    {
      id: "F1",
      name: "信息属于字段",
      rule: "顺序为标签、控件、必要说明或错误；错误靠近对应字段。",
      reason: "避免无法知道错误影响哪个输入。",
      check: "点击标签定位；错误ID和aria-describedby关联。",
    },
    {
      id: "F2",
      name: "横向选择对齐",
      rule: "横向复选框/开关与首行标签对齐；多行描述延续同一文字轴。",
      reason: "可读性需要一致的扫描起点。",
      check: "检查长标签、错误与第二个字段之间间距。",
    },
  ],
  inputs: [
    "Field orientation；data-invalid 与真实校验同步",
    "FieldLabel htmlFor；FieldDescription / FieldError 对应控件",
  ],
  events: ["事件由内部输入控件发出；Field不增加二次保存事件"],
  composition: [
    "直接复用 src/components/ui/field.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["点击扩展名称标签，输入值。", "勾选启用扩展，查看两项布局。"],
      expected: "标签定位控件，两项间距明确，信息归属无混淆。",
      render: () => <BasicControlExample kind="field" mode="normal" />,
    },
    {
      id: "invalid",
      name: "无效输入",
      section: "exception",
      condition: "通过参数给出对应状态，示例不调用真实后端。",
      steps: ["查看无效边界及字段错误关联。", "输入并检查原值可编辑。"],
      expected:
        "错误文字就近可读并关联控件，不清空输入；本例校验状态由调用方指定。",
      render: () => <BasicControlExample kind="field" mode="invalid" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
