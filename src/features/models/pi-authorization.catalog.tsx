import { PiAuthorizationExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
export default {
  id: "pi-authorization",
  name: "Pi 授权交互",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/pi-authorization.tsx",
  description: "显示 Pi 实际授权通知和提示，提交输入并支持取消。",
  boundary: "正式组件接收服务；本展示使用替身，不连接账号。",
  inputs: ["connection", "service"],
  events: ["onComplete(connection)", "onClose"],
  composition: ["Dialog", "Field", "Input", "Select", "Button"],
  consumers: ["ConnectionEditor"],
  viewport: { width: 800, height: 650 },
  states: [
    {
      id: "default",
      name: "设备码与输入",
      condition: "服务返回授权提示",
      expected: "提交后结束，关闭会取消。",
      render: () => <PiAuthorizationExample />,
    },
  ],
} satisfies CatalogEntry
