import { ConnectionFieldsExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "credential-fields",
  name: "连接凭据",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/credential-fields.tsx",
  description: "三种凭据方式；密钥默认隐藏，可显示、复制与更换。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["value: ModelConnection", "errors"],
  events: ["onChange", "onClearKey"],
  composition: ["Field", "RadioGroup", "Input", "ApiKeyField"],
  consumers: ["ConnectionFields"],
  viewport: { width: 720, height: 320 },
  states: [
    {
      id: "key",
      name: "密钥已保存",
      condition: "密钥已保存",
      expected: "切换方式并回写候选值",
      render: () => <ConnectionFieldsExample credentialOnly mode="key" />,
    },
    {
      id: "environment",
      name: "环境变量",
      condition: "环境变量",
      expected: "切换方式并回写候选值",
      render: () => (
        <ConnectionFieldsExample credentialOnly mode="environment" />
      ),
    },
    {
      id: "none",
      name: "无凭据",
      condition: "无凭据",
      expected: "切换方式并回写候选值",
      render: () => <ConnectionFieldsExample credentialOnly mode="none" />,
    },
  ],
} satisfies CatalogEntry
