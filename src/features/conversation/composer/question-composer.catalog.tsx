import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { QuestionComposer } from "./question-composer"
import type { ConversationQuestion, QuestionDraft } from "../conversation-types"
const questions: ConversationQuestion[] = [
  {
    id: "scope",
    header: "实现范围",
    question: "这次优先检查哪些界面？",
    detail: "选择一项后自动进入下一题；也可以填写自己的范围。",
    options: [
      { label: "首页和对话页（推荐）", description: "完成核心工作入口" },
      { label: "全部已有界面", description: "同时检查组件库" },
    ],
  },
  {
    id: "checks",
    header: "验证项",
    question: "需要关注哪些交互？",
    multiSelect: true,
    options: [
      { label: "键盘操作", description: "Tab和Enter流程" },
      { label: "窄屏布局", description: "避免工具栏和消息溢出" },
    ],
  },
]
function Example({
  error = false,
  free = false,
}: {
  error?: boolean
  free?: boolean
}) {
  const items = free
    ? [{ id: "free", question: "还有什么需要补充？" }]
    : questions
  const [draft, setDraft] = useState<QuestionDraft>({
    index: 0,
    answers: items.map(() => ({ selected: [], custom: "", skipped: false })),
    minimized: false,
  })
  const [result, setResult] = useState("")
  return (
    <div className="p-4">
      {result ? (
        <p role="status">{result}</p>
      ) : (
        <QuestionComposer
          questions={items}
          draft={draft}
          onDraftChange={setDraft}
          error={error ? "模拟提交失败，请保留答案后重试。" : undefined}
          onAnswer={(answers) => setResult(`已提交 ${answers.length} 个回答`)}
          onCancel={() => setResult("已放弃整组问题")}
        />
      )}
    </div>
  )
}
export default {
  id: "question-composer",
  name: "问题回答",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/question-composer.tsx",
  description: "问题接管普通输入区，逐题作答并保留草稿。",
  boundary: "问题与提交事件由父级提供；不调用agent，支持受控草稿按会话恢复。",
  inputs: ["questions、draft/onDraftChange、busy、error、stopping"],
  events: [
    "单选自动下一题、多选合并、自定义替换单选；跳过、分页、收起/展开及放弃。",
    "onAnswer提交完整答案；onCancel放弃整组；onStop仅停止执行。",
  ],
  composition: [
    "RadioGroup、Checkbox、Textarea、FieldSet/FieldLegend、FieldGroup、Button、Badge",
  ],
  consumers: ["ConversationPage"],
  viewport: { width: 800, height: 520 },
  states: [
    {
      id: "questions",
      name: "单选与多选",
      condition: "两题，第二题多选",
      expected: "单选自动前进，返回保留选择，完成后提交。",
      render: () => <Example />,
    },
    {
      id: "free",
      name: "自由回答",
      condition: "无预设选项",
      expected: "自动聚焦，Enter提交，输入法选字不提交。",
      render: () => <Example free />,
    },
    {
      id: "error",
      name: "提交失败",
      condition: "父级错误反馈",
      expected: "显示错误并保留编辑能力与草稿。",
      render: () => <Example error />,
    },
  ],
} satisfies CatalogEntry
