import { ModelEditorExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "model-editor",
  name: "模型编辑弹窗",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/model-editor.tsx",
  description: "接口、思考、输入能力和token限制的完整模型表单。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["initial", "originalId", "existing", "connectionName"],
  events: ["onSave(model)", "onClose"],
  composition: [
    "Dialog",
    "Field",
    "Input",
    "Select",
    "RadioGroup",
    "Checkbox",
    "SettingsConfirmDialog",
  ],
  consumers: ["ConnectionEditor"],
  viewport: { width: 900, height: 720 },
  states: [
    {
      id: "new",
      name: "添加模型",
      condition: "新模型",
      expected: "必填与重复ID、正整数、输出上限校验；加入草稿",
      render: () => <ModelEditorExample />,
    },
    {
      id: "edit",
      name: "编辑模型",
      condition: "已有模型",
      expected: "修改取消时确认，保留原模型",
      render: () => <ModelEditorExample edit />,
    },
  ],
} satisfies CatalogEntry
