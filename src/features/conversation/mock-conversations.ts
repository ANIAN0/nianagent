import { homeData } from "../home/mock-data"
import type { ComposerDraft } from "@/lib/composer/types"
import type {
  ConversationMessage,
  ConversationSession,
} from "./conversation-types"

export function emptyDraft(workspaceId = "moon"): ComposerDraft {
  return {
    workspaceId,
    text: "",
    model: homeData.models[0],
    thinking: "中等",
    materials: [],
    session: {
      toolIds: homeData.tools.map((tool) => tool.id),
      instructionScope: "all",
    },
  }
}

// These fixtures are simulated transcripts, not records of tool execution.
const time = (minute: number) => `2026-10-02T10:${minute}:00+08:00`
const user = (
  id: string,
  text: string,
  minute: number,
  extra: Partial<ConversationMessage> = {}
): ConversationMessage => ({
  id,
  role: "user",
  text,
  time: time(minute),
  status: "settled",
  ...extra,
})
const assistant = (
  id: string,
  text: string,
  minute: number,
  extra: Partial<ConversationMessage> = {}
): ConversationMessage => ({
  id,
  role: "assistant",
  text,
  time: time(minute),
  model: homeData.models[0],
  status: "settled",
  ...extra,
})
const read = (id: string, input: string, result: string) => ({
  id,
  name: "读取文件",
  source: "模拟工具",
  status: "success" as const,
  input,
  result,
})

export const noteQuestions = [
  {
    id: "notes-format",
    header: "输出格式",
    question: "这周的工作笔记希望如何整理？",
    options: [
      {
        label: "按项目分组",
        description: "每个项目分别列出进展、决策与下一步",
      },
      { label: "按日期排列", description: "保留每天的工作顺序，便于回顾" },
    ],
  },
  {
    id: "notes-content",
    header: "保留内容",
    question: "周报需要包含哪些内容？",
    multiSelect: true,
    options: [
      { label: "完成事项", description: "只保留有明确结果的工作" },
      { label: "待办任务", description: "列出负责人和预期时间" },
      { label: "问题与决策", description: "记录影响后续安排的取舍" },
    ],
  },
  {
    id: "notes-audience",
    header: "补充说明",
    question: "这份笔记主要给谁阅读？",
    detail: "可以补充读者、篇幅或需要略去的内部内容。",
  },
]

const homeMessages = [
  user(
    "1-u1",
    "对照首页原型，帮我检查输入、目录选择和工具配置的交互。先列问题，不修改代码。",
    24
  ),
  assistant(
    "1-a1",
    `首页的操作顺序是 **选择目录 → 描述需求 → 发起工作**。我整理了三个需要明确的边界。

| 位置 | 当前行为 | 建议处理 |
| --- | --- | --- |
| 工作目录 | 更换目录后输入仍在 | 保留正文和附件，只更新本次工作上下文 |
| 工具配置 | 面板内可以修改多个选项 | 点击「应用」后生效；取消恢复已保存配置 |
| 消息发送 | Enter 提交输入 | 输入法组合期间不发送，Shift + Enter 换行 |

目录和模型属于下一条消息的配置，不应追溯修改已经发出的消息。工具面板则需要独立的候选状态，避免取消时产生隐式保存。`,
    25,
    {
      thinking: {
        text: "先沿输入草稿、目录切换和工具配置的调用关系核对状态归属，再区分立即生效与需要确认的操作。",
        duration: "4 秒",
      },
      tools: [
        read(
          "home-read-1",
          "src/features/home/home-composer.tsx",
          "示例：输入与材料保存在 ComposerDraft，发送前统一读取最新草稿。"
        ),
        read(
          "home-read-2",
          "src/components/composer/session-config.tsx",
          "示例：面板维护候选工具列表，应用时提交，取消时丢弃。"
        ),
      ],
    }
  ),
  user(
    "1-u2",
    "把这些整理成开发清单。目录切换时不要丢掉我正在写的内容，取消配置也不要改变已有选择。",
    27
  ),
  assistant(
    "1-a2",
    `建议先处理状态边界，再检查键盘操作。

### 草稿与配置

- [x] 明确目录切换仅更新工作上下文
- [x] 明确「应用」与「取消」各自的保存边界
- [ ] 为输入草稿与配置候选值分别维护状态
  - 保留正文、附件和已选模型
  - 关闭面板时清除未应用的候选值
- [ ] 在切换会话后恢复各自的草稿

### 发送规则

纯空白输入不可发送；有附件时可以不填正文。中文输入法确认候选词时不发送消息，换行使用 **Shift + Enter**。

> 以上是根据示例上下文整理的审查结论，尚未修改项目文件。`,
    28
  ),
]

export const directoryMarkdown = `目录职责可以按变化原因划分：基础控件不依赖业务，会话组件围绕消息、输入和会话状态组织。

### 建议结构

\`\`\`text
src/
  components/ui/                 # 通用控件
  features/
    home/                       # 工作入口与会话导航
    conversation/
      messages/                 # 消息、附件、执行过程
      composer/                 # 草稿、排队消息、问题表单
      conversation-page.tsx     # 阅读区与输入区布局
      conversation-service.ts # 正式会话服务接口
  lib/                          # 与 UI 无关的共享函数
\`\`\`

### 让消息模型保持稳定

组件接收明确的数据与事件，不直接查找全局当前会话。下面的类型只描述呈现消息所需的信息。

\`\`\`ts
type Message = {
  id: string
  role: "user" | "assistant"
  text: string
  status: "streaming" | "settled" | "failed"
}

function updateMessage(messages: Message[], next: Message) {
  return messages.map(message =>
    message.id === next.id ? next : message
  )
}
\`\`\`

### 调整导入边界

\`\`\`diff
- import { currentSession } from "../../App"
+ import type { ConversationMessage } from "../conversation-types"
\`\`\`

| 目录 | 可以依赖 | 不应依赖 |
| --- | --- | --- |
| components/ui | 主题、通用辅助函数 | 当前会话、工作目录 |
| conversation/messages | 消息类型、基础控件 | 全局路由、模拟服务 |
| conversation/composer | 草稿类型、基础控件 | 消息列表内部布局 |
| conversation-page | 消息与输入组件 | 文件系统与真实模型调用 |

这能把视觉调整与会话调度分开。消息内容变化时，不需要重写页面布局；替换模拟服务时，也不需要改动消息气泡。

### 迁移顺序

1. 先固定数据类型和事件签名。
2. 将重复控件移到明确的共享位置。
3. 逐个迁移使用方，保留已有交互。
4. 最后统一检查正式页面与组件库。

**暂不拆分只有单一使用方的细碎函数。** 是否共享应由职责和实际复用决定，不能只根据文件行数。`

const transcripts: ConversationMessage[][] = [
  homeMessages,
  [
    user(
      "2-u1",
      "检查项目目录结构，给我一个不依赖页面全局状态的组件组织方案，并说明迁移顺序。",
      30
    ),
    assistant("2-a1", directoryMarkdown, 31, {
      blocks: [
        {
          id: "directory-intro",
          type: "text",
          text: "先检查入口和消息类型，再整理依赖边界。",
        },
        {
          id: "directory-read",
          type: "tool",
          tool: read(
            "directory-read-tool",
            "src/App.tsx",
            "示例：入口持有当前会话，消息组件通过 props 接收内容。"
          ),
        },
        {
          id: "directory-mid",
          type: "text",
          text: "页面布局与会话调度可以保持分离。下面将目录职责整理成一份文档补丁。",
        },
        {
          id: "directory-edit",
          type: "tool",
          tool: {
            id: "directory-edit-tool",
            name: "编辑文件",
            source: "模拟工具",
            status: "success",
            input: "docs/component-boundaries.md",
            result: "示例补丁包含目录职责表与迁移顺序，未写入真实文件。",
          },
        },
        { id: "directory-result", type: "text", text: directoryMarkdown },
      ],
      thinking: {
        text: "从入口追踪依赖，重点区分状态调度、页面布局与消息呈现。",
        duration: "6 秒",
      },
      tools: [
        read(
          "tree-read",
          "src/App.tsx",
          "示例：App 负责会话选择和数据调度，消息内容通过 props 传入。"
        ),
        read(
          "type-read",
          "src/features/conversation/conversation-types.ts",
          "示例：消息、草稿与问题回答已有独立类型。"
        ),
        {
          id: "structure-write",
          name: "编辑文件",
          source: "模拟工具",
          status: "success",
          input: "docs/component-boundaries.md",
          result: "示例补丁：新增目录职责表和迁移顺序；未写入真实文件。",
        },
      ],
    }),
  ],
  [
    user("3-u1", "检查开发环境，看看为什么前端服务没有启动。", 32),
    assistant(
      "3-a1",
      "服务没有启动。示例终端返回端口占用，需要先确认占用进程，再决定复用服务还是更换端口。",
      33,
      {
        status: "failed",
        tools: [
          {
            id: "env-command",
            name: "运行命令",
            source: "模拟工具",
            status: "failed",
            input: "pnpm dev -- --port 5173 --strictPort",
            result:
              "Error: Port 5173 is already in use.\n这是预置失败结果，未运行命令。",
            exitCode: 1,
          },
        ],
      }
    ),
    user("3-u2", "先检查 5173 的占用情况，不要结束其他进程。", 34),
    assistant(
      "3-a2",
      "正在确认端口归属。尚未获得进程详情，未停止任何服务。",
      34,
      {
        status: "interrupted",
        thinking: { text: "先只读查询进程，避免影响其他项目的开发服务。" },
        tools: [
          {
            id: "env-port",
            name: "运行命令",
            source: "模拟工具",
            status: "stopped",
            input: "Get-NetTCPConnection -LocalPort 5173",
            result: "查询在返回结果前已停止。",
          },
          {
            id: "env-next",
            name: "读取文件",
            source: "模拟工具",
            status: "not-run",
            input: "vite.config.ts",
            result: "前一步已停止，此步骤未执行。",
          },
        ],
      }
    ),
  ],
  [
    user(
      "4-u1",
      "把本周关于 Moon 的工作笔记整理成周报：周一确认首页，周三完成对话原型，周五准备审查。先问我需要保留什么。",
      35
    ),
    assistant(
      "4-a1",
      "可以。我会把已完成的工作、仍待确认的事项和下一步安排分开，先确认这份周报的组织方式和读者。",
      36
    ),
  ],
  [
    user(
      "5-u1",
      "阅读这两份材料并整理摘要，附图是 Moon 的应用标识。把确定的结论和待确认的问题分开。",
      37,
      {
        attachments: [
          {
            id: "brand-image",
            name: "Moon应用标识.svg",
            kind: "image",
            url: "/moon.svg",
          },
          {
            id: "brief-file",
            name: "Moon本地工作入口与交互设计说明-2026年10月讨论稿.md",
            kind: "file",
            bytes: 2480,
            content:
              "# Moon 设计说明\n\n应用提供本地工作入口。首页用于选择工作目录和表达需求，会话页用于阅读结果、补充需求和确认问题。\n\n已确定：沿用确认后的原型；Lucide 图标；本地思源黑体。\n待确认：会话归档与搜索的长期存储方案。",
          },
          {
            id: "notes-file",
            name: "讨论记录.txt",
            kind: "file",
            bytes: 560,
            content:
              "讨论记录（示例）\n1. 保持导航低对比，发送按钮为主要动作。\n2. 回复中的执行过程默认折叠。\n3. 错误后保留输入和已有消息，允许重试。",
          },
        ],
      }
    ),
    assistant(
      "5-a1",
      `两份材料讨论的是同一条工作路径：**进入工作目录，表达需求，在会话中持续推进。**

### 已确定

- 首页负责发起工作，会话页负责阅读与跟进。
- 图标与字体统一使用已有项目资源。
- 执行过程默认收起，展开后查看输入、结果和失败原因。

### 需要继续明确

| 事项 | 已知约束 | 仍需确认 |
| --- | --- | --- |
| 会话搜索 | 按标题或目录定位 | 历史记录如何持久化 |
| 失败恢复 | 保留已有消息与草稿 | 重试是否复用上次工具结果 |
| 附件 | 发送前可移除，发送后可预览 | 大文件和不支持格式的处理 |

附图为项目已有的 Moon 标识，仅用于识别应用，不作为正文装饰。以上摘要仅依据附带的示例文本，未读取本地目录。`,
      38
    ),
  ],
]

export function initialSessions(): ConversationSession[] {
  return homeData.conversations.map((item, index) => ({
    id: item.id,
    title: item.title,
    workspaceId: item.workspaceId,
    messages: structuredClone(transcripts[index]),
    draft: emptyDraft(item.workspaceId),
    phase: index === 3 ? "waiting" : "idle",
    loadState: "ready",
    queue:
      index === 2
        ? [
            {
              id: "env-queue-1",
              draft: {
                ...emptyDraft(item.workspaceId),
                text: "如果是现有开发服务，请复用它。",
              },
            },
            {
              id: "env-queue-2",
              draft: {
                ...emptyDraft(item.workspaceId),
                text: "再整理前端和 Tauri 的启动方式。",
              },
            },
          ]
        : [],
    ...(index === 3 ? { questions: structuredClone(noteQuestions) } : {}),
  }))
}

export function mockReply(text: string, recovered = false): string {
  if (recovered)
    return "已重新取得示例上下文，可以继续整理当前任务。\n\n本次模拟重试已完成，未调用模型或执行本地命令。"
  if (/模拟失败|模拟超时/.test(text))
    return "未能取得工具结果：连接等待超过约定时间。已有消息和草稿仍保留，可以重试本条回复。\n\n这是模拟失败，没有发起真实网络请求。"
  if (/确认|问我/.test(text))
    return "开始整理前，先确认输出的组织方式、需要保留的内容和阅读对象。"
  if (/目录|结构|组件/.test(text))
    return (
      directoryMarkdown + "\n\n本次内容来自本地示例，未读取或修改项目文件。"
    )
  return `可以，先按这项要求继续整理：${text}\n\n### 下一步\n\n1. 保留当前会话中已经确定的约束。\n2. 将待处理内容按优先级整理成清单。\n3. 对仍不确定的部分单独标注，避免混入已完成事项。\n\n| 内容 | 处理方式 |\n| --- | --- |\n| 已确认的要求 | 沿用，不重复询问 |\n| 新补充的内容 | 纳入本轮工作 |\n| 尚不明确的边界 | 列为待确认事项 |\n\n这条回复由本地模拟数据生成，未调用模型或执行工具。`
}
