import { ModelDirectoryExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "model-directory",
  name: "连接模型目录",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/model-directory.tsx",
  description: "模型名称与ID、接口能力、token限制以及行操作。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["models", "checks", "busy"],
  events: ["onEdit", "onCheck", "onRemove"],
  composition: [
    "Table",
    "Input",
    "DropdownMenu",
    "SettingsPagination",
    "Empty",
  ],
  consumers: ["ConnectionEditor"],
  viewport: { width: 1000, height: 720 },
  states: [
    {
      id: "default",
      name: "模型目录",
      condition: "3个模型",
      expected: "编辑、检查、移除可操作",
      render: () => <ModelDirectoryExample />,
    },
    {
      id: "empty",
      name: "空模型",
      condition: "无模型",
      expected: "显示手工添加/测试发现说明",
      render: () => <ModelDirectoryExample empty />,
    },
    {
      id: "failed",
      name: "检查失败",
      condition: "模拟检查错误",
      expected: "失败不移除模型",
      render: () => <ModelDirectoryExample failed />,
    },
  ],
} satisfies CatalogEntry
