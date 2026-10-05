import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ComposerInputCard } from "./composer-input-card"
import { useComposerKeyboard } from "./composer-keymap"
import {
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { SendControl } from "@/features/home/send-control"

function Example({
  drop = false,
  disabledDrop = false,
  long = false,
}: {
  drop?: boolean
  disabledDrop?: boolean
  long?: boolean
}) {
  const [value, setValue] = useState(
    long
      ? "这是一份较长的草稿，用于检查正文局部滚动与固定操作栏。\n".repeat(20)
      : ""
  )
  const [notice, setNotice] = useState("")
  const keyboard = useComposerKeyboard(() => {
    if (value.trim()) setNotice("已触发提交事件（展示）")
  })
  return (
    <div className="flex w-full max-w-[720px] flex-col gap-3 p-6">
      <ComposerInputCard
        dropActive={drop}
        dropDisabledReason={disabledDrop ? "当前暂不能添加附件" : undefined}
      >
        <InputGroupTextarea
          aria-label="输入卡正文"
          placeholder="描述你要做的事…"
          className="px-3.5 pt-3 pb-0 text-[15px] leading-6"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          {...keyboard}
        />
        <InputGroupAddon align="block-end" className="px-3 pt-2 pb-2.5">
          <span className="flex-1 text-xs text-muted-foreground">
            Enter发送 · Shift+Enter换行
          </span>
          <SendControl disabled={!value.trim()} />
        </InputGroupAddon>
      </ComposerInputCard>
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
    </div>
  )
}
export default {
  id: "composer-input-card",
  name: "共用输入卡",
  layer: "复合组件",
  group: "工作输入",
  source: "src/components/composer/composer-input-card.tsx",
  description:
    "首页、会话和排队编辑复用的20px圆角输入壳与拖放反馈，正文与工具栏独立间隔12px。",
  boundary: "只负责卡片视觉与拖放提示；草稿、材料owner和提交由正式消费者持有。",
  inputs: ["InputGroup属性；dropActive/dropDisabledReason决定拖放提示。"],
  events: [
    "本展示使用正式共用键图；IME尾窗、Alt/AltGraph和重复Enter不提交，Shift+Enter换行。",
  ],
  composition: ["InputGroup", "InputGroupTextarea", "InputGroupAddon"],
  consumers: ["HomeComposer", "ConversationComposer", "QueueEditEditor"],
  viewport: { width: 800, height: 480 },
  states: [
    {
      id: "focus",
      name: "空闲与焦点",
      condition: "聚焦正文。",
      expected: "中性边框变主题色60%，出现3px/20%主题焦点；不依赖页面类。",
      render: () => <Example />,
    },
    {
      id: "long",
      name: "长正文",
      condition: "20行文字。",
      expected: "正文局部滚动，底部操作栏留在输入卡内。",
      render: () => <Example long />,
    },
    {
      id: "drop",
      name: "附件拖入",
      condition: "正式dropActive提示。",
      expected: "卡内覆盖松开提示；不遮挡全页、不改变原草稿。",
      render: () => <Example drop />,
    },
    {
      id: "drop-disabled",
      name: "暂不能拖入",
      condition: "拖放期间当前输入不可添加附件。",
      expected: "明确当前状态，不假装已添加。",
      render: () => <Example drop disabledDrop />,
    },
  ],
} satisfies CatalogEntry
