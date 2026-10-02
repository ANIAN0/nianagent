import { ConnectionFieldsExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "connection-fields",
  name: "连接服务表单",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/connection-fields.tsx",
  description:
    "名称、端点、凭据、自定义始终展开的请求头；双列布局在窄容器改单列。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["value", "errors", "disabled"],
  events: ["onChange(patch)", "onClearKey(apply)"],
  composition: ["Field", "Input", "Textarea", "CredentialFields"],
  consumers: ["ConnectionEditor"],
  viewport: { width: 800, height: 550 },
  states: [
    {
      id: "saved",
      name: "已保存密钥",
      condition: "密钥保管",
      expected: "默认遮蔽，可显示、复制或直接输入新密钥；请求头始终展示",
      render: () => <ConnectionFieldsExample />,
    },
    {
      id: "invalid",
      name: "字段错误",
      condition: "必填与JSON错误",
      expected: "错误关联字段，输入保持",
      render: () => <ConnectionFieldsExample invalid />,
    },
    {
      id: "environment",
      name: "环境变量",
      condition: "变量引用",
      expected: "只存变量名",
      render: () => <ConnectionFieldsExample mode="environment" />,
    },
    {
      id: "none",
      name: "无凭据",
      condition: "本地服务",
      expected: "不发送凭据",
      render: () => <ConnectionFieldsExample mode="none" />,
    },
  ],
} satisfies CatalogEntry
