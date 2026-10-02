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
import { SessionConfig } from "./session-config"
function Example({ empty = false }: { empty?: boolean }) {
  const [value, setValue] = useState<SessionOptions>({
    toolIds: empty ? [] : homeData.tools.map((tool) => tool.id),
    instructionScope: "all",
  })
  return (
    <div className="@container p-6">
      <SessionConfig
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
function AsyncExample({
  mode,
}: {
  mode: "ready" | "loading" | "load-error" | "save-error"
}) {
  const [value, setValue] = useState<SessionOptions>({
    toolIds: [],
    instructionScope: "all",
  })
  const [sessionId, setSessionId] = useState("preview-session-a")
  const [service] = useState<SessionService>(() => {
    const snapshots = new Map<string, SessionConfiguration>()
    let loads = 0
    let saves = 0
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
    const delay = (signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        signal?.throwIfAborted()
        const finish = () => {
          signal?.removeEventListener("abort", abort)
          resolve()
        }
        const timer = setTimeout(finish, mode === "loading" ? 5000 : 500)
        const abort = () => {
          clearTimeout(timer)
          reject(new DOMException("已取消", "AbortError"))
        }
        signal?.addEventListener("abort", abort, { once: true })
      })
    return {
      catalog: async (_, signal) => {
        await delay(signal)
        if (mode === "load-error" && loads++ === 0)
          throw new Error("工作目录暂时无法读取，请重试。")
        return catalog
      },
      read: async (id, signal) => {
        await delay(signal)
        return snapshots.get(id) ?? null
      },
      apply: async (input, signal) => {
        await delay(signal)
        if (mode === "save-error" && saves++ === 0)
          throw new Error("配置保存失败，候选选择已保留。")
        const result: SessionConfiguration = {
          ...input,
          revision: (input.revision ?? 0) + 1,
          effectiveToolIds: input.toolIds,
          unavailableToolIds: [],
          instructions:
            input.instructionScope === "none" ? [] : catalog.instructions,
        }
        snapshots.set(input.sessionId, result)
        return result
      },
    }
  })
  return (
    <SessionServiceContext.Provider value={service}>
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
          onClick={() => {
            setSessionId((id) =>
              id === "preview-session-a"
                ? "preview-session-b"
                : "preview-session-a"
            )
            setValue({ toolIds: [], instructionScope: "all" })
          }}
        >
          切换演示会话
        </Button>
        <p className="mt-4 text-xs" role="status">
          {sessionId} · 已应用 {value.toolIds.length} 个工具 ·{" "}
          {value.instructionScope}
        </p>
      </div>
    </SessionServiceContext.Provider>
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
    "弹窗拥有候选值；正式入口使用SessionService读取与保存，取消丢弃编辑，异步结果按sessionId和目录隔离。展示通过独立服务替身避免访问生产。",
  inputs: [
    "sessionId、tools、value: SessionOptions、workspacePath；SessionServiceContext提供真实或演示服务。",
  ],
  events: ["onChange(value)，仅应用时触发。"],
  composition: [
    "Dialog",
    "Tabs",
    "ToolPicker",
    "InstructionScopePicker",
    "Button",
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
      id: "save-error",
      name: "应用失败与重试",
      condition: "首次应用失败",
      expected: "保留选择，重试成功才关闭并更新已应用值。",
      render: () => <AsyncExample mode="save-error" />,
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
      id: "empty",
      name: "无可用工具",
      condition: "工具数组为空。",
      expected: "空状态清晰，仍可切换项目指令；未修改时应用禁用。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
