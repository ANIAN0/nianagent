import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ToolCall } from "./tool-call"
export default {
  id: "conversation-tool-call",
  name: "工具调用",
  layer: "复合组件",
  group: "对话过程",
  source: "src/features/conversation/messages/tool-call.tsx",
  description:
    "工具语义图标、目标和状态；命令执行目录与输出分层，一次展开即可查看结果，实际diff独立呈现，原始参数次级折叠。",
  boundary:
    "只查看已记录数据，不执行真实命令。not-run表示调用已经生成但从未开始执行，不能展示成功或失败，不补退出码与耗时。",
  inputs: [
    "tool: ConversationToolCall（exitCode/durationMs仅按记录展示）",
    "defaultOpen",
  ],
  events: [
    "展开工具与原始参数",
    "展开超过20行的结果",
    "复制结果",
    "通过正式材料服务预览目标",
  ],
  composition: ["Collapsible", "Button", "CopyButton", "MessageAttachments"],
  consumers: ["ExecutionProcess", "AssistantMessage", "ConversationTurnView"],
  viewport: { width: 760, height: 500 },
  states: [
    {
      id: "not-run",
      name: "调用未执行",
      condition:
        "Pi正在生成Bash调用参数，输入仅有部分命令，执行开始前本轮中断或结束，状态为not-run。",
      expected:
        "摘要显示未执行，展开结果明确写此调用未执行；保留已记录的部分命令，不显示成功/失败、退出码未提供或耗时。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "not-run-bash",
              name: "bash",
              source: "Pi",
              status: "not-run",
              input: '{"command":"node scripts/veri"}',
            }}
          />
        </div>
      ),
    },
    {
      id: "command-success",
      name: "命令退出码0",
      condition: "Pi结构化返回退出码0与耗时840ms",
      expected:
        "显示成功；展开结果独立显示真实执行目录，随后显示命令输出、0与840毫秒，不把0当缺失。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "command",
              name: "powershell",
              source: "Pi",
              status: "success",
              input: '{"command":"Test-Path README.md"}',
              result: "True",
              exitCode: 0,
              durationMs: 840,
              target: {
                kind: "command",
                command: "Test-Path README.md",
                cwd: "H:/工作区/moon/用户提供的较长目录名称/设计方案与交付验收/会话消息/真实命令运行目录",
              },
            }}
          />
        </div>
      ),
    },
    {
      id: "command-code-unknown",
      name: "命令退出码未知",
      condition: "历史工具结果缺少退出码",
      expected:
        "摘要已返回，执行目录未记录、退出码未提供；不以当前会话目录补历史，不补0或宣称命令成功。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "unknown-code",
              name: "powershell",
              source: "Pi",
              status: "success",
              result: "该历史只保存了输出文本。",
            }}
          />
        </div>
      ),
    },
    {
      id: "stopped",
      name: "执行中断",
      condition: "命令在返回结果前停止",
      expected: "保留输入，结果明确标注已停止而非空白或成功。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "stopped",
              name: "读取工作目录下的项目配置",
              source: "本地工作区文件工具",
              status: "stopped",
              input:
                '{"path":"H:/workspace/moon/src/features/conversation/messages"}',
            }}
          />
        </div>
      ),
    },
    {
      id: "success",
      name: "执行成功",
      condition: "已保存结果",
      expected: "展开后输入默认折叠，结果展开。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "read",
              name: "读取文件",
              source: "内置工具",
              status: "success",
              input: '{"path":"src/App.tsx"}',
              result: "export default App",
            }}
          />
        </div>
      ),
    },
    {
      id: "running",
      name: "执行中",
      condition: "没有结果",
      expected: "摘要为执行中；展开提示尚未收到结果。",
      render: () => (
        <div className="p-6">
          <ToolCall
            tool={{
              id: "run",
              name: "检查项目",
              source: "内置工具",
              status: "running",
              input: "读取目录结构",
            }}
          />
        </div>
      ),
    },
    {
      id: "failed",
      name: "非零退出码",
      condition: "退出码1",
      expected: "即使状态success也呈现失败。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "failed",
              name: "powershell",
              source: "内置工具",
              status: "success",
              exitCode: 1,
              durationMs: 1260,
              result: "找不到指定文件。",
            }}
          />
        </div>
      ),
    },
    {
      id: "long",
      name: "长结果",
      condition: "30行结果",
      expected: "先显示20行，可展开和收起。",
      render: () => (
        <div className="p-6">
          <ToolCall
            defaultOpen
            tool={{
              id: "long",
              name: "读取目录",
              source: "内置工具",
              status: "success",
              result: Array.from(
                { length: 30 },
                (_, i) => `第 ${i + 1} 行记录`,
              ).join("\n"),
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
