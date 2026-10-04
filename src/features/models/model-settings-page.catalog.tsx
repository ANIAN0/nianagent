import { SettingsPageExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "model-settings-page",
  name: "模型设置",
  layer: "页面",
  group: "模型设置",
  source: "src/features/models/model-settings-page.tsx",
  description:
    "设置工作区、模型连接与MCP服务；保存发布目录，返回工作台保留会话。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: [
    "service: ModelService",
    "mcpService: MCP服务依赖；展示环境注入独立替身",
    "onConnectionsChange: 已保存目录变更",
    "registerLeave: 注册离开保护",
  ],
  events: ["onReturn 返回工作台；未保存先确认"],
  composition: [
    "ConnectionList",
    "McpSettings",
    "ConnectionEditor",
    "AddConnectionDialog",
    "SettingsConfirmDialog",
  ],
  consumers: ["App"],
  viewport: { width: 1280, height: 720 },
  states: [
    {
      id: "default",
      name: "连接目录",
      condition: "包含正常、空、失效账号与环境变量连接",
      expected: "进入编辑、保存/取消、搜索/分页与返回可用",
      render: () => <SettingsPageExample />,
    },
    {
      id: "empty",
      name: "空目录",
      condition: "没有连接",
      expected: "可从添加连接进入新建流程",
      render: () => <SettingsPageExample empty />,
    },
    {
      id: "many",
      name: "大量连接",
      condition: "24个连接",
      expected: "每页5/10/20/50，保存后可定位连接",
      render: () => <SettingsPageExample many />,
    },
    {
      id: "load-error",
      name: "读取失败",
      condition: "首次读取模拟失败",
      expected: "重试恢复目录",
      render: () => <SettingsPageExample failure="list" />,
    },
    {
      id: "delete-error",
      name: "删除失败",
      condition: "首次删除模拟失败",
      expected: "确认框保留错误和重试，不提前删除",
      render: () => <SettingsPageExample failure="remove" />,
    },
    {
      id: "load-restart",
      name: "宿主版本不匹配",
      condition: "读取返回restart",
      expected: "使用重启指引，不提供伪重试；窄窗仍可进入MCP",
      render: () => <SettingsPageExample failure="list-restart" />,
    },
    {
      id: "delete-unknown",
      name: "删除结果待核对",
      condition: "已提交删除丢失响应",
      expected: "保留原对象/请求ID，仅回执可确认；关闭后仍可核对",
      render: () => <SettingsPageExample failure="remove-unknown" />,
    },
  ],
} satisfies CatalogEntry
