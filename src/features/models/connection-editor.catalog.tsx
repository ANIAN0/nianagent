import { ConnectionEditorExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "connection-editor",
  name: "连接编辑",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/connection-editor.tsx",
  description: "服务配置、测试发现、模型草稿与固定保存底栏。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: [
    "initial: 连接基线",
    "connections: 名称判重",
    "service: ModelService；展示注入正式契约的内存替身",
  ],
  events: ["onSaved", "onAccountSaved", "onClose", "registerLeave"],
  composition: [
    "ConnectionFields",
    "ModelDirectory",
    "DiscoveredModels",
    "ModelEditor",
    "PiAuthorization",
    "SettingsConfirmDialog",
  ],
  consumers: ["ModelSettingsPage"],
  viewport: { width: 1000, height: 720 },
  states: [
    {
      id: "saved",
      name: "已保存连接",
      condition: "已保存连接",
      expected: "密钥默认遮蔽，可显示/复制；测试不保存；模型增改进入草稿",
      render: () => <ConnectionEditorExample />,
    },
    {
      id: "new",
      name: "新建连接",
      condition: "新建连接",
      expected: "空值校验，允许保存没有模型的连接",
      render: () => <ConnectionEditorExample kind="new" />,
    },
    {
      id: "environment",
      name: "环境变量不可用",
      condition: "环境变量不可用",
      expected: "可改用DEMO_API_KEY后测试，不读真实环境",
      render: () => <ConnectionEditorExample kind="environment" />,
    },
    {
      id: "subscription",
      name: "登录已失效",
      condition: "登录已失效",
      expected: "授权确认、范围、取消与登录结果生效",
      render: () => <ConnectionEditorExample kind="subscription" />,
    },
    {
      id: "logout-unknown",
      name: "退出后响应未知",
      condition: "示例退出已执行但响应丢失",
      expected:
        "账号区域只读核对当前状态，不重复退出/新授权，不称原写回执；保留连接和模型草稿",
      render: () => (
        <ConnectionEditorExample
          kind="subscription-active"
          failure="logout-unknown"
        />
      ),
    },
    {
      id: "logout-read-error",
      name: "账号状态读取失败",
      condition: "退出响应未知后，只读目录失败",
      expected: "单一账号反馈保持核对入口，挡重复退出和新授权；可继续只读恢复",
      render: () => (
        <ConnectionEditorExample
          kind="subscription-active"
          failure="logout-read-error"
        />
      ),
    },
    {
      id: "logout-read-restart",
      name: "账号读取要求重启",
      condition: "退出响应未知后，目录返回restart",
      expected: "只给重启指引，不把重复退出/授权当恢复",
      render: () => (
        <ConnectionEditorExample
          kind="subscription-active"
          failure="logout-read-restart"
        />
      ),
    },
    {
      id: "logout-read-busy",
      name: "账号仍在清理",
      condition: "当前登录值已变化但accountOperationBusy仍为true",
      expected: "保持未知门禁，前两次只读核对不释放；权威false后才能重新授权",
      render: () => (
        <ConnectionEditorExample
          kind="subscription-active"
          failure="logout-read-busy"
        />
      ),
    },
    {
      id: "logout-read-unsupported",
      name: "旧宿主缺少账号忙碌证据",
      condition: "目录缺少accountOperationBusy字段",
      expected: "要求更新重启，不靠再次读取登录值解除门禁",
      render: () => (
        <ConnectionEditorExample
          kind="subscription-active"
          failure="logout-read-unsupported"
        />
      ),
    },
    {
      id: "save-error",
      name: "保存失败",
      condition: "保存失败",
      expected: "输入保留，可再次保存",
      render: () => <ConnectionEditorExample failure="save" />,
    },
    {
      id: "test-error",
      name: "测试失败",
      condition: "测试失败",
      expected: "错误可见，不清除已保存模型，可重试",
      render: () => <ConnectionEditorExample failure="discover" />,
    },
    {
      id: "check-error",
      name: "模型检查失败",
      condition: "模型检查失败",
      expected: "在模型行保留失败信息与模型",
      render: () => <ConnectionEditorExample failure="check" />,
    },
    {
      id: "save-unknown",
      name: "保存结果待确认",
      condition: "原保存已提交但返回丢失",
      expected: "仅核对原写入回执；允许继续编辑，确认后保留后续草稿",
      render: () => <ConnectionEditorExample failure="save-unknown" />,
    },
    {
      id: "save-pending",
      name: "保存尚未确认",
      condition: "回执保持unknown",
      expected: "不凭目录猜成功，不换revision盲重提；离开后重新编辑仍可核对",
      render: () => <ConnectionEditorExample failure="save-unknown-pending" />,
    },
    {
      id: "discover-restart",
      name: "目录服务需重启",
      condition: "host_version recovery restart",
      expected: "展示重启指引，不把再次检测当恢复",
      render: () => <ConnectionEditorExample failure="discover-restart" />,
    },
    {
      id: "check-unknown",
      name: "推理检查结果未知",
      condition: "真实检查未收到结果（示例替身）",
      expected: "不提供自动重试；新检查明确会再次请求",
      render: () => <ConnectionEditorExample failure="check-unknown" />,
    },
  ],
} satisfies CatalogEntry
