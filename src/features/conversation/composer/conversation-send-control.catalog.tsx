import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ConversationSendControl } from "./conversation-send-control"
import "./composer.css"
export default {
  id: "conversation-send-control",
  name: "对话发送控制",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/conversation-send-control.tsx",
  description: "同一主按钮按运行状态切换发送、排队、停止。",
  boundary: "不拥有执行状态，停止通过回调发出，发送使用所在表单submit。",
  inputs: ["running、stopping、hasDraft、disabled、onStop"],
  events: ["空闲或排队触发表单提交；停止调用onStop。"],
  composition: ["InputGroupButton、Lucide ArrowUp/Square/LoaderCircle"],
  consumers: ["ConversationComposer"],
  viewport: { width: 340, height: 160 },
  states: [
    {
      id: "basic-running",
      name: "真实对话生成中",
      condition: "运行且有下一条草稿；基础模式不排队",
      expected: "始终显示停止；草稿保留",
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
      expected: "方形停止图标，标签停止执行",
      render: () => (
        <ConversationSendControl running hasDraft={false} onStop={() => {}} />
      ),
    },
    {
      id: "queue",
      name: "排队发送",
      condition: "运行且有草稿",
      expected: "箭头图标，标签排队发送",
      render: () => (
        <ConversationSendControl running hasDraft onStop={() => {}} />
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
