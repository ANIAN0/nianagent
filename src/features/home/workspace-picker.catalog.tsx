import { useRef, useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import type { Workspace } from "./home-types"
import { WorkspacePicker } from "./workspace-picker"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { FeedbackDescription } from "@/lib/operation-issue"

type ExampleState =
  | "available"
  | "empty"
  | "unavailable"
  | "loading"
  | "error"
  | "cancel"
  | "read-error"
  | "restart"
  | "read-cancelled"
  | "local-check-success"
  | "local-check-failure"

function readDelay(signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel)
      resolve()
    }, 450)
    function cancel() {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener("abort", cancel, { once: true })
  })
}

function Example({ state = "available" }: { state?: ExampleState }) {
  const [value, setValue] = useState(
    state === "empty" ? "" : homeData.workspaces[0]!.id
  )
  const [items, setItems] = useState<Workspace[]>(
    state === "empty"
      ? []
      : homeData.workspaces.map((item, index) => ({
          ...item,
          available: !(state === "unavailable" && index === 0),
          unavailableReason:
            state === "unavailable" && index === 0
              ? "工作目录不存在或不可访问，请重新选择。"
              : "",
        }))
  )
  const [attempted, setAttempted] = useState(false)
  const [status, setStatus] = useState("")
  const [reading, setReading] = useState(false)
  const pendingSelection = useRef<string | undefined>(undefined)
  const failedCheck = useRef(false)
  const [issue, setIssue] = useState<FeedbackDescription | undefined>(() =>
    ["read-error", "restart", "read-cancelled"].includes(state)
      ? {
          code:
            state === "restart"
              ? "host_version"
              : state === "read-cancelled"
                ? "cancelled"
                : "workspace_read",
          message:
            state === "restart"
              ? "Moon 服务版本已更新，请重新启动 Moon。"
              : state === "read-cancelled"
                ? "本次工作目录读取已取消。"
                : "工作目录列表暂时无法读取，当前选择已保留。",
          recovery: state === "restart" ? "restart" : "reload",
          severity: state === "read-cancelled" ? "info" : "error",
        }
      : undefined
  )
  return (
    <div className="p-6">
      <WorkspacePicker
        workspaces={items}
        value={value}
        loading={state === "loading" || reading}
        issue={issue}
        onRetry={async (signal) => {
          setReading(true)
          try {
            await readDelay(signal)
            if (state === "local-check-failure" && !failedCheck.current) {
              failedCheck.current = true
              throw Object.assign(new Error("工作目录读取失败。"), {
                issue: {
                  code: "workspace_read",
                  summary: "工作目录暂时无法读取，尚未确认选择结果。",
                  severity: "error",
                  recovery: "retry",
                },
              })
            }
            setIssue(undefined)
            setItems((current) =>
              current.map((item) => ({
                ...item,
                available: true,
                unavailableReason: "",
              }))
            )
            if (pendingSelection.current) setValue(pendingSelection.current)
            setStatus(
              pendingSelection.current
                ? "已读取确认原选择已保存，旧错误提示应消失。"
                : "已重新读取演示目录，原选择保持不变。"
            )
          } finally {
            if (!signal?.aborted) setReading(false)
          }
        }}
        onChange={(next) => {
          if (["local-check-success", "local-check-failure"].includes(state)) {
            pendingSelection.current = next
            throw Object.assign(new Error("选择结果待核对。"), {
              issue: {
                code: "result_unknown",
                summary: "工作目录选择结果尚未确认，请先核对目录。",
                severity: "warning",
                recovery: "check",
              },
            })
          }
          setValue(next)
        }}
        onChooseDirectory={async () => {
          if (state === "error" && !attempted) {
            setAttempted(true)
            throw new Error("工作区保存失败，请重试。")
          }
          if (state === "cancel") {
            setStatus("已取消，工作目录保持不变。")
            return
          }
          const item = {
            id: "chosen-demo",
            name: "新的演示目录",
            path: "H:/demo/project",
            available: true,
            unavailableReason: "",
          }
          setItems((current) =>
            current.some((record) => record.id === item.id)
              ? current
              : [...current, item]
          )
          setValue(item.id)
          setStatus("已添加并选中演示目录。")
        }}
      />
      <p role="status" className="text-sm text-muted-foreground">
        {status ||
          `当前工作区：${items.find((item) => item.id === value)?.name ?? "未选择"}`}
      </p>
    </div>
  )
}
export default {
  id: "workspace-picker",
  name: "工作目录选择",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/workspace-picker.tsx",
  description:
    "紧凑目录菜单，保留名称、尾部勾选和底部添加；正式页面直接打开系统目录选择器。",
  boundary:
    "受控目录、异步选择与添加；不保存独立目录副本。原生能力经注入回调调用，组件库使用内存替身，不打开系统窗。",
  inputs: [
    "workspaces/value：正式目录与当前选择；available=false 的记录保留并禁选。",
    "loading/issue/error/disabled：读取状态；issue保留原因、严重程度和恢复动作，error仅兼容旧调用方。",
    "onRetry(signal)：正式目录刷新返回Promise，只有读取结果已接纳才完成；只读演示可兼容void。",
  ],
  events: [
    "onChange(id,signal)：持久化成功后父级更新选择。",
    "onChooseDirectory(signal)：父级打开系统窗，取消不变，成功登记并更新目录和选择。",
    "重新读取/核对：等待回调成功才清除本地失败；失败展示读取的真实原因，重试继续读取，不重发选择。",
  ],
  composition: ["Button", "DropdownMenu", "RecoveryAction"],
  consumers: ["HomeComposer"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "available",
      name: "目录切换",
      condition: "已有两个目录。",
      expected: "保留单行名称与勾选；添加使用注入的目录选择能力。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "尚无目录",
      condition: "真实目录列表为空。",
      expected: "主色浅底入口清晰可见，保留添加工作区操作，添加后选中。",
      render: () => <Example state="empty" />,
    },
    {
      id: "unavailable",
      name: "目录失效",
      condition: "当前目录被删除或无权限。",
      expected:
        "原因紧邻目录入口，窄容器换至下一行；失效行不可选，可重新读取或切换到可用目录，不出现全宽红色Alert。",
      render: () => <Example state="unavailable" />,
    },
    {
      id: "loading",
      name: "读取中",
      condition: "正在恢复工作区。",
      expected: "读取反馈，禁止重复操作。",
      render: () => <Example state="loading" />,
    },
    {
      id: "error",
      name: "添加失败后重试",
      condition: "第一次添加失败。",
      expected: "保留原选择，重试后成功。",
      render: () => <Example state="error" />,
    },
    {
      id: "read-error",
      name: "目录读取失败",
      condition: "工作目录列表请求失败，原选择仍存在。",
      expected: "紧邻目录说明并提供重新读取目录，恢复不改草稿或选择。",
      render: () => <Example state="read-error" />,
    },
    {
      id: "restart",
      name: "服务需重启",
      condition: "工作目录读取返回host_version/restart。",
      expected: "说明需重启，不提供无效重试；目录入口与状态共同保持紧凑布局。",
      render: () => <Example state="restart" />,
    },
    {
      id: "read-cancelled",
      name: "读取已取消",
      condition: "当前读取被用户取消，原目录保留。",
      expected: "使用中性信息并提供重新读取，不显示红色错误。",
      render: () => <Example state="read-cancelled" />,
    },
    {
      id: "local-check-success",
      name: "选择失败后核对成功",
      condition: "从菜单选择另一已有目录，选择结果未知。",
      expected:
        "显示核对目录；核对期间保留原提示并禁止重复请求，450ms后采用确认的目录并清除旧提示；不打开原生目录窗。",
      render: () => <Example state="local-check-success" />,
    },
    {
      id: "local-check-failure",
      name: "核对失败后再读取",
      condition: "选择另一已有目录后核对，第一次读取失败。",
      expected:
        "核对失败显示读取真实原因，原选择不变；重试执行目录读取，成功采用已保存选择并清除提示，不重发目录选择。",
      render: () => <Example state="local-check-failure" />,
    },
    {
      id: "cancel",
      name: "取消系统选择",
      condition: "目录选择替身返回取消。",
      expected: "无新目录、无错误提示、原选择不变。",
      render: () => <Example state="cancel" />,
    },
  ],
} satisfies CatalogEntry
