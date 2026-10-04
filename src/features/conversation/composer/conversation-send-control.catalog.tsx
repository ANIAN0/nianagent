import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ConversationSendControl } from "./conversation-send-control"
import "./composer.css"
export default {
  id: "conversation-send-control",
  name: "对话发送控制",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/conversation-send-control.tsx",
  description:
    "普通会话无可提交下一稿时使用唯一主停止；可提交下一稿时主动作排队，次级停止仍可用。压缩命令只在空闲打开面板。",
  boundary: "不拥有执行状态，停止通过回调发出，发送使用所在表单submit。",
  inputs: ["running、stopping、hasDraft、disabled、command、onStop"],
  events: ["空闲或排队触发表单提交；停止调用onStop。"],
  composition: ["InputGroupButton、Lucide ArrowUp/Square/LoaderCircle"],
  consumers: ["ConversationComposer"],
  viewport: { width: 340, height: 160 },
  states: [
    {
      id: "basic-running",
      name: "真实对话生成中",
      condition: "运行且有下一条草稿；基础模式不排队",
      expected: "唯一主停止可用，不支持排队时草稿保留",
      render: () => (
        <ConversationSendControl
          running
          hasDraft
          allowQueue={false}
          onStop={() => {}}
        />
      ),
    },
    {
      id: "idle",
      name: "发送",
      condition: "有效草稿",
      expected: "蓝色圆形箭头",
      render: () => <ConversationSendControl hasDraft onStop={() => {}} />,
    },
    {
      id: "stop",
      name: "停止执行",
      condition: "运行且无草稿",
      expected: "仅展示可用的蓝色主停止，不出现空白禁用发送",
      render: () => (
        <ConversationSendControl running hasDraft={false} onStop={() => {}} />
      ),
    },
    {
      id: "queue",
      name: "排队发送",
      condition: "运行且有草稿",
      expected: "蓝色排队主动作与低强调次级停止可用，草稿独立",
      render: () => (
        <ConversationSendControl running hasDraft onStop={() => {}} />
      ),
    },
    {
      id: "compact-command",
      name: "打开压缩面板",
      condition: "空闲且草稿是 /compact 调用。",
      expected: "主动作标为打开压缩面板，点击只提交到所属表单，不发给模型。",
      render: () => (
        <ConversationSendControl command="compact" hasDraft onStop={() => {}} />
      ),
    },
    {
      id: "compact-running",
      name: "运行中保留压缩草稿",
      condition: "当前工作未结束，草稿为 /compact。",
      expected: "保留压缩草稿，唯一主动作停止当前执行。",
      render: () => (
        <ConversationSendControl
          command="compact"
          running
          hasDraft
          disabled
          onStop={() => {}}
        />
      ),
    },
    {
      id: "stopping",
      name: "正在停止",
      condition: "停止请求待完成",
      expected: "旋转进度且按钮禁用",
      render: () => (
        <ConversationSendControl stopping hasDraft={false} onStop={() => {}} />
      ),
    },
  ],
} satisfies CatalogEntry
