import { AuthorizationExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "subscription-authorization",
  name: "订阅账号授权",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/subscription-authorization.tsx",
  description: "设备码、服务确认信息、授权范围、等待、失败与过期。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["service", "expiresAfter=180", "name"],
  events: ["onComplete(account)", "onClose"],
  composition: ["Dialog", "Field", "Input", "Select", "Button"],
  consumers: ["ConnectionEditor"],
  viewport: { width: 800, height: 600 },
  states: [
    {
      id: "default",
      name: "完整授权",
      condition: "模拟服务逐步返回",
      expected: "输入确认信息并选择范围完成；取消中止请求",
      render: () => <AuthorizationExample />,
    },
    {
      id: "expired",
      name: "设备码过期",
      condition: "2秒过期",
      expected: "旧响应不能完成授权，可重新开始",
      render: () => <AuthorizationExample expired />,
    },
    {
      id: "failed",
      name: "授权失败",
      condition: "首次请求失败",
      expected: "错误可见，重试可恢复",
      render: () => <AuthorizationExample failed />,
    },
  ],
} satisfies CatalogEntry
