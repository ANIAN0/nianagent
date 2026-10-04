import { Button } from "@/components/ui/button"
import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { SessionOptions } from "./home-types"
import {
  SessionServiceContext,
  type SessionService,
} from "@/features/session/session-service"
import type {
  SessionConfiguration,
  SessionCatalog,
} from "@/features/models/model-contract.generated"
import { createExtensionFixtureService } from "../../../ui-catalog/fixtures/extensions"
import { SessionConfig } from "./session-config"
import { AppShell } from "./app-shell"
import {
  NavigationBoundaryContext,
  useNavigationBoundaryState,
} from "./navigation-boundary"
type AsyncMode =
  | "ready"
  | "loading"
  | "load-error"
  | "load-restart"
  | "load-cancelled"
  | "save-error"
  | "save-restart"
  | "save-wait"
  | "save-unknown-confirmed"
  | "save-unknown-pending"
  | "save-unknown-read-error"
  | "save-unknown-restart"
  | "save-unknown-uncommitted"
  | "save-unknown-conflict"
function serviceIssue(
  code: string,
  summary: string,
  details: string,
  recovery: "retry" | "check" | "reload" | "restart" = "retry",
  severity: "error" | "warning" = "error"
) {
  return Object.assign(new Error(summary), {
    issue: { code, summary, details, recovery, severity },
  })
}
function Example({
  empty = false,
  disabled = false,
}: {
  empty?: boolean
  disabled?: boolean
}) {
  const [extensionService] = useState(createExtensionFixtureService)
  const [value, setValue] = useState<SessionOptions>({
    toolIds: empty ? [] : homeData.tools.map((tool) => tool.id),
    instructionScope: "all",
  })
  return (
    <div className="@container p-6">
      <SessionConfig
        extensionService={extensionService}
        disabled={disabled}
        disabledReason="先检查原消息的发送状态，再修改会话配置。"
        tools={empty ? [] : homeData.tools}
        value={value}
        workspacePath={homeData.workspaces[0]!.path}
        onChange={setValue}
      />
      <p role="status" className="mt-4 text-sm">
        已应用：{value.toolIds.length} 个工具 · {value.instructionScope}
      </p>
    </div>
  )
}
function AsyncExample({ mode }: { mode: AsyncMode }) {
  const navigation = useNavigationBoundaryState()
  const [value, setValue] = useState<SessionOptions>({
    toolIds: [],
    instructionScope: "all",
  })
  const [sessionId, setSessionId] = useState("preview-session-a")
  const [applyCount, setApplyCount] = useState(0)
  const [commitCount, setCommitCount] = useState(0)
  const [service] = useState<SessionService>(() => {
    const snapshots = new Map<string, SessionConfiguration>()
    const awaiting = new Map<string, SessionConfiguration>()
    let loads = 0
    let saves = 0
    let checks = 0
    const commit = (snapshot: SessionConfiguration) => {
      snapshots.set(snapshot.sessionId, structuredClone(snapshot))
      setCommitCount((count) => count + 1)
    }
    const catalog: SessionCatalog = {
      cwd: "H:/workspace/moon",
      tools: [
        {
          id: "read",
          name: "读取文件",
          description: "读取工作目录中的文件",
          group: "Pi 内置工具",
          detail: "读取指定路径的文本内容。",
          available: true,
          unavailableReason: "",
        },
        {
          id: "bash",
          name: "运行 Bash",
          description: "执行 Bash 命令",
          group: "Pi 内置工具",
          detail: "需要本机 Bash 运行环境。",
          available: false,
          unavailableReason: "未找到 Bash 可执行文件",
        },
      ],
      instructions: [
        {
          path: "H:/workspace/moon/AGENTS.md",
          source: "directory",
          content: "# 项目约定\n\n沿用已确认的设计。",
        },
      ],
      defaults: { toolIds: ["read"], instructionScope: "all" },
    }
    const delay = (signal?: AbortSignal, saving = false, duration?: number) =>
      new Promise<void>((resolve, reject) => {
        signal?.throwIfAborted()
        const finish = () => {
          signal?.removeEventListener("abort", abort)
          resolve()
        }
        const timer = setTimeout(
          finish,
          duration ??
            (mode === "loading" || (saving && mode === "save-wait")
              ? 5000
              : 500)
        )
        const abort = () => {
          clearTimeout(timer)
          reject(new DOMException("已取消", "AbortError"))
        }
        signal?.addEventListener("abort", abort, { once: true })
      })
    return {
      catalog: async (_, signal) => {
        await delay(signal)
        loads++
        if (mode === "load-restart")
          throw serviceIssue(
            "host_version",
            "Moon 服务版本已更新，请重新启动 Moon。",
            "演示：读取前确认宿主版本与当前代码不一致。",
            "restart"
          )
        if (mode === "load-error" && loads === 1)
          throw serviceIssue(
            "workspace_unavailable",
            "工作目录暂时无法读取，请重试。",
            "演示：读取工作区工具与项目指令时发生临时访问失败。"
          )
        if (mode === "load-cancelled" && loads === 1)
          throw new DOMException("已取消读取", "AbortError")
        return catalog
      },
      read: async (id, signal) => {
        await delay(signal)
        const candidate = awaiting.get(id)
        if (candidate) {
          if (mode === "save-unknown-restart")
            throw serviceIssue(
              "host_version",
              "Moon 服务版本已更新，请重新启动 Moon。",
              "演示：原保存结果未知，核对读取发现宿主版本已经变化。",
              "restart"
            )
          checks++
          if (checks === 1) {
            if (mode === "save-unknown-read-error")
              throw serviceIssue(
                "host_unavailable",
                "暂时无法读取已保存配置。",
                "演示：提交回执丢失后，首次只读核对也未能连接宿主。"
              )
            return snapshots.get(id) ?? null
          }
          // The panel stays editable while reconciling. A later candidate edit
          // must survive confirmation of this earlier submitted snapshot.
          await delay(signal, false, 5000)
          commit(candidate)
          awaiting.delete(id)
        }
        return snapshots.get(id) ?? null
      },
      apply: async (input, signal) => {
        saves++
        setApplyCount((count) => count + 1)
        await delay(signal, true)
        if (mode === "save-restart")
          throw serviceIssue(
            "host_version",
            "Moon 服务版本已更新，请重新启动 Moon。",
            "演示：写请求尚未分派便检测到宿主版本不一致。",
            "restart"
          )
        // If A was still committing after the first read, it wins before the
        // explicit retry acquires the same session's configuration gate.
        const earlier = awaiting.get(input.sessionId)
        if (earlier) {
          commit(earlier)
          awaiting.delete(input.sessionId)
        }
        const previous = snapshots.get(input.sessionId)
        if (
          previous
            ? input.revision !== previous.revision
            : input.revision !== undefined
        )
          throw serviceIssue(
            "session_revision_conflict",
            "会话配置版本已变化，请读取当前会话的已保存配置后再应用。",
            "演示：原提交版本只能成功保存一次，重试不会创建第二个版本。",
            "reload"
          )
        if (mode === "save-error" && saves === 1)
          throw serviceIssue(
            "session_write_failed",
            "配置保存失败，候选选择已保留。",
            "演示：正式提交之前写入被明确拒绝；重试仍使用原候选。"
          )
        const result: SessionConfiguration = {
          ...input,
          revision: (input.revision ?? 0) + 1,
          effectiveToolIds: input.toolIds,
          unavailableToolIds: [],
          instructions:
            input.instructionScope === "none" ? [] : catalog.instructions,
        }
        if (mode.startsWith("save-unknown") && saves === 1) {
          if (mode === "save-unknown-confirmed") commit(result)
          else if (mode === "save-unknown-conflict")
            commit({
              ...result,
              toolIds: [],
              effectiveToolIds: [],
              instructionScope:
                input.instructionScope === "none" ? "all" : "none",
              instructions:
                input.instructionScope === "none" ? catalog.instructions : [],
            })
          else if (mode !== "save-unknown-uncommitted")
            awaiting.set(input.sessionId, result)
          throw serviceIssue(
            "result_unknown",
            "未能确认本次配置是否已保存，请先核对。",
            "演示：保存请求已交给宿主，但提交回执未能返回。",
            "check",
            "warning"
          )
        }
        commit(result)
        return result
      },
    }
  })
  const content = (
    <div className="@container p-6">
      <SessionConfig
        sessionId={sessionId}
        tools={[]}
        value={value}
        workspacePath="H:/workspace/moon"
        onChange={setValue}
      />
      <Button
        variant="link"
        size="sm"
        className="ml-4"
        disabled={navigation.blocked}
        onClick={() => {
          navigation.run(() => {
            setSessionId((id) =>
              id === "preview-session-a"
                ? "preview-session-b"
                : "preview-session-a"
            )
            setValue({ toolIds: [], instructionScope: "all" })
          })
        }}
      >
        切换演示会话
      </Button>
      <p className="mt-4 text-xs" role="status">
        {sessionId} · 已应用 {value.toolIds.length} 个工具 ·{" "}
        {value.instructionScope} · 应用请求 {applyCount} 次 · 实际保存{" "}
        {commitCount} 次
      </p>
    </div>
  )
  return (
    <NavigationBoundaryContext.Provider value={navigation}>
      <SessionServiceContext.Provider value={service}>
        {mode === "save-wait" ? (
          <AppShell
            data={homeData}
            activeConversationId={sessionId}
            onNew={() => setSessionId("preview-session-a")}
            onSelectConversation={(item) => {
              setSessionId(item.id)
              setValue({ toolIds: [], instructionScope: "all" })
            }}
          >
            {content}
          </AppShell>
        ) : (
          content
        )}
      </SessionServiceContext.Provider>
    </NavigationBoundaryContext.Provider>
  )
}
export default {
  id: "session-config",
  name: "会话配置",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/session-config.tsx",
  description: "在工具和项目指令两个面板中修改会话候选配置。",
  boundary:
    "弹窗拥有候选值；正式入口使用SessionService读取与保存。结果未知时先只读核对，读旧值后可显式按原revision重试冻结的A，CAS约束每个原版本最多保存一次，不将后续B混入。待核对A/B以Service+sessionId+cwd隔离在内存中保留，确认后删除；目录服务不会访问生产。",
  inputs: [
    "sessionId、tools、value: SessionOptions、workspacePath；SessionServiceContext提供真实或演示服务。",
  ],
  events: [
    "onChange(value)：首次读取用于同步已有保存值，候选编辑不回写，应用成功后回写新值。",
    "只有真实保存/核对请求期间暂时阻止关闭和导航；未知允许纯关闭或导航，关闭不撤销可能的提交，重开恢复冻结A并读取权威配置。确认A后保留后续B；读到其他新版本时同步生效基线、保留候选并解除待核对状态。",
    "结构化原因与详情原位呈现；当前读取取消可中性重读，关闭或切换作用域后的取消不产生反馈。",
  ],
  composition: [
    "Dialog",
    "Tabs",
    "ToolPicker",
    "ExtensionConfig",
    "InstructionScopePicker",
    "Button",
    "OperationFeedback",
    "Skeleton",
    "RecoveryAction",
  ],
  consumers: ["ComposerToolbar", "ConversationComposer"],
  viewport: { width: 720, height: 620 },
  states: [
    {
      id: "async-ready",
      name: "服务读取与会话隔离",
      condition: "独立内存服务替身",
      expected: "读取实际目录结果后编辑，保存并重开恢复；切换会话不串草稿。",
      render: () => <AsyncExample mode="ready" />,
    },
    {
      id: "loading",
      name: "读取中",
      condition: "服务延迟5秒",
      expected: "显示加载占位，不能提交，可取消。",
      render: () => <AsyncExample mode="loading" />,
    },
    {
      id: "load-error",
      name: "读取失败与重试",
      condition: "首次读取失败",
      expected: "显示错误，重新读取后恢复工具与指令。",
      render: () => <AsyncExample mode="load-error" />,
    },
    {
      id: "load-restart",
      name: "配置服务需重启",
      condition: "读取会话配置返回host_version/restart。",
      expected:
        "保留配置与草稿，仅显示重启指导，不提供无效重新读取或应用动作；可以关闭。",
      render: () => <AsyncExample mode="load-restart" />,
    },
    {
      id: "save-error",
      name: "应用失败与重试",
      condition: "首次应用失败",
      expected: "保留选择，重试成功才关闭并更新已应用值。",
      render: () => <AsyncExample mode="save-error" />,
    },
    {
      id: "load-cancelled",
      name: "读取取消与恢复",
      condition: "首次当前读取返回取消，随后可正常读取。",
      expected: "中性说明与重新读取，保留取消按钮；不使用红色错误。",
      render: () => <AsyncExample mode="load-cancelled" />,
    },
    {
      id: "save-restart",
      name: "应用前服务需重启",
      condition: "编辑候选并点击应用，正式分派之前返回host_version/restart。",
      expected:
        "候选与原配置保留，应用禁用；只显示重启指导，可以取消，不给读取旧宿主的按钮。",
      render: () => <AsyncExample mode="save-restart" />,
    },
    {
      id: "save-unknown-restart",
      name: "未知保存遇到旧宿主",
      condition: "原保存回执未知，随后核对时发现host_version/restart。",
      expected:
        "冻结提交和后续候选保留，重启指导优先；不提供无效核对/按原版本重试，重开仍用同一原提交。",
      render: () => <AsyncExample mode="save-unknown-restart" />,
    },
    {
      id: "save-unknown-confirmed",
      name: "未知提交已生效",
      condition: "保存已提交但回执丢失，同会话只读返回匹配配置。",
      expected: "自动核对后确认成功；应用请求计数仍为1，不再次写入。",
      render: () => <AsyncExample mode="save-unknown-confirmed" />,
    },
    {
      id: "save-unknown-pending",
      name: "未知提交与后续编辑",
      condition: "首次只读返回旧值；原提交在按原版本重试之前完成。",
      expected:
        "未知时可修改B并关闭或切换会话，返回后恢复A/B；固定原版本重试会触发CAS冲突，再读确认A，B仍保留且导航解锁。可能有2次应用请求，但实际只保存1次。",
      render: () => <AsyncExample mode="save-unknown-pending" />,
    },
    {
      id: "save-unknown-read-error",
      name: "未知提交核对失败",
      condition: "保存回执未知，第一次只读核对也失败。",
      expected:
        "保存状态仍未知，诊断详情保留两次原因；只能核对，不能把读失败当写入拒绝或再次应用。",
      render: () => <AsyncExample mode="save-unknown-read-error" />,
    },
    {
      id: "save-unknown-uncommitted",
      name: "未提交的未知请求恢复",
      condition: "首次请求回执未知且未保存，只读返回null。",
      expected:
        "核对后仅有按原版本重试主动作；重试仍提交冻结A，成功后保留B。实际保存1次，不会永久封锁弹窗或导航。",
      render: () => <AsyncExample mode="save-unknown-uncommitted" />,
    },
    {
      id: "save-unknown-conflict",
      name: "未知提交被其他配置更新",
      condition: "回执丢失后只读返回更高版本的不同配置。",
      expected:
        "明确当前会话已保存配置已重新读取，候选仍保留；解除待核对与导航门禁，可按最新版本另行应用。",
      render: () => <AsyncExample mode="save-unknown-conflict" />,
    },
    {
      id: "save-wait",
      name: "保存期间的应用导航边界",
      condition: "配置应用延迟5秒；组件与AppShell共用正式导航边界。",
      expected:
        "点击应用后Ctrl+K/Ctrl+B、会话选择、切换演示会话和Esc不能离开保存画面；结果返回后显示配置已应用，导航恢复。",
      render: () => <AsyncExample mode="save-wait" />,
    },
    {
      id: "enabled",
      name: "完整配置",
      condition: "内置、插件和 MCP 三组模拟工具。",
      expected:
        "搜索、整组选中、详情可操作；取消不改变摘要，应用同步工具数和范围。",
      render: () => <Example />,
    },
    {
      id: "disabled-submission",
      name: "发送待核对的禁用配置",
      condition: "首页原发送结果尚未确认。",
      expected:
        "Tab及悬浮可了解真实理由，不显示等待回复的错误原因；Enter不会打开弹窗。",
      render: () => <Example disabled />,
    },
    {
      id: "empty",
      name: "无可用工具",
      condition: "工具数组为空。",
      expected: "空状态清晰，仍可切换项目指令；未修改时应用禁用。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
