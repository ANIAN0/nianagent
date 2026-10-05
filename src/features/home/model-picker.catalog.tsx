import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ModelPicker, type ModelPickerCatalog } from "./model-picker"
import { effectiveThinking } from "./model-thinking"

type Mode =
  | "available"
  | "long"
  | "empty"
  | "loading"
  | "error"
  | "restart"
  | "cancelled"
  | "restricted"
  | "no-reasoning"
  | "unavailable"
  | "locked"
function Example({ mode = "available" }: { mode?: Mode }) {
  const [status, setStatus] = useState<ModelPickerCatalog["status"]>(
    mode === "loading"
      ? "loading"
      : ["error", "restart", "cancelled"].includes(mode)
        ? "error"
        : "ready"
  )
  const [notice, setNotice] = useState("")
  const items =
    mode === "empty"
      ? []
      : ["本地服务", "远程服务"].flatMap((connection, group) =>
          Array.from({ length: mode === "long" ? 12 : 2 }, (_, index) => ({
            value: `${group}/${index}`,
            connection,
            modelId: `model-${index}`,
            name:
              mode === "long"
                ? `同名模型-超长服务版本标识-2026-October-Enterprise ${index}`
                : `模型 ${index + 1}`,
          }))
        )
  const [value, setValue] = useState(
    mode === "empty" ? "" : mode === "unavailable" ? "已移除的模型" : "0/0"
  )
  const [thinking, setThinking] = useState("高")
  const thinkingByModel = Object.fromEntries(
    items.map((item) => [
      item.value,
      mode === "no-reasoning" ? [] : ["高", "最高"],
    ])
  )
  return (
    <div className="flex min-h-[500px] items-center justify-center p-6">
      <div>
        <ModelPicker
          disabled={mode === "locked"}
          disabledReason={
            mode === "locked"
              ? "当前工作仍在运行，停止后可更换模型与思考强度。"
              : undefined
          }
          models={items.map((item) => item.value)}
          value={value}
          thinking={effectiveThinking(thinking, thinkingByModel[value])}
          thinkingByModel={thinkingByModel}
          catalog={{
            items,
            status,
            error: "模型目录读取失败，请重新读取。",
            issue:
              status === "error"
                ? {
                    code:
                      mode === "restart"
                        ? "host_version"
                        : mode === "cancelled"
                          ? "cancelled"
                          : "model_catalog",
                    message:
                      mode === "restart"
                        ? "Moon 服务版本已更新，请重新启动 Moon。"
                        : mode === "cancelled"
                          ? "本次模型读取已取消。"
                          : "模型目录暂时无法读取，当前选择已保留。",
                    recovery: mode === "restart" ? "restart" : "reload",
                    severity: mode === "cancelled" ? "info" : "error",
                    details:
                      mode === "restart"
                        ? undefined
                        : "演示：读取模型目录的请求未完成。",
                  }
                : undefined,
            onRetry: () => {
              setStatus("ready")
              setNotice("已重新读取演示目录")
            },
            onOpenSettings: () => setNotice("已打开模型设置（演示导航）"),
          }}
          onChange={setValue}
          onThinkingChange={setThinking}
        />
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice ||
            `当前选择：${value || "未选择"} ${effectiveThinking(thinking, thinkingByModel[value])}`}
        </p>
      </div>
    </div>
  )
}
export default {
  id: "model-picker",
  name: "模型选择",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/model-picker.tsx",
  description:
    "模型与思考共用两级菜单；按连接分组，方向键浏览、Enter或空格确认。入口复用Button composer变体/尺寸，与会话配置统一外观；名称宽度按工具栏空间收缩。",
  boundary:
    "页面提供目录状态、重试和设置导航；组件不读取后端。窗口移动、尺寸及可用高度变化时重新计算边界，子页内部滚动。",
  inputs: [
    "models/value/labels；catalog：结构化身份、加载状态、issue和恢复回调；thinkingByModel：支持的等级；disabled/disabledReason：可聚焦读取的锁原因。",
  ],
  events: [
    "超过4项提供按名称/ID/连接搜索；搜索后方向键进入选项、Enter确认，IME尾窗/Alt/重复Enter不确认。onChange、onThinkingChange仅确认时触发。",
  ],
  composition: [
    "Popover",
    "Button",
    "Separator",
    "PickerOption",
    "ThinkingPicker",
    "OperationFeedback",
    "RecoveryAction",
  ],
  consumers: ["ComposerToolbar", "ConversationComposer"],
  viewport: { width: 760, height: 650 },
  states: [
    {
      id: "locked",
      name: "运行时锁定",
      condition: "当前工作使用既定模型。",
      expected:
        "模型与思考整体锁定；Tab 和悬停均能读取实际原因，不影响停止工作。",
      render: () => <Example mode="locked" />,
    },
    {
      id: "available",
      name: "选择与键盘",
      condition: "两个连接，方向键浏览",
      expected: "分组明确，上下不改选择，Enter确认，Esc退一级并回焦",
      render: () => <Example />,
    },
    {
      id: "long",
      name: "长名与多模型",
      condition: "24个跨连接同名长模型",
      expected:
        "模型子页默认聚焦搜索，按名称/ID/连接筛选；空结果明确；Check和身份可见；改变窗口可用高度后列表局部滚动。",
      render: () => <Example mode="long" />,
    },
    {
      id: "empty",
      name: "空目录",
      condition: "无模型",
      expected: "入口可开，可进入设置，无伪思考档位",
      render: () => <Example mode="empty" />,
    },
    {
      id: "loading",
      name: "正在读取",
      condition: "目录读取中",
      expected: "明确加载状态，保留当前选择",
      render: () => <Example mode="loading" />,
    },
    {
      id: "error",
      name: "读取失败",
      condition: "目录读取失败",
      expected: "可重试并恢复，或进入设置",
      render: () => <Example mode="error" />,
    },
    {
      id: "restart",
      name: "服务需重启",
      condition: "目录请求返回host_version/restart。",
      expected: "错误提供重启指导；不提供无效重新读取。当前选择保留。",
      render: () => <Example mode="restart" />,
    },
    {
      id: "cancelled",
      name: "读取取消",
      condition: "当前模型目录读取返回cancelled/info，允许用户重新读取。",
      expected: "中性反馈，重新读取后恢复；不出现红色错误。",
      render: () => <Example mode="cancelled" />,
    },
    {
      id: "restricted",
      name: "限定思考等级",
      condition: "支持高与最高",
      expected: "仅两档，方向键不提交",
      render: () => <Example mode="restricted" />,
    },
    {
      id: "no-reasoning",
      name: "无思考能力",
      condition: "等级为空",
      expected: "无思考入口",
      render: () => <Example mode="no-reasoning" />,
    },
    {
      id: "unavailable",
      name: "原选择失效",
      condition: "模型被移除",
      expected: "保留旧身份，提示修复，可选择其他模型",
      render: () => <Example mode="unavailable" />,
    },
  ],
} satisfies CatalogEntry
