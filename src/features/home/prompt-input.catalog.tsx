import { MaterialServiceContext } from "@/features/materials/material-service"
import {
  exampleMaterialService,
  exampleMaterials,
} from "@/features/materials/material-catalog-fixtures"
import type { Material } from "./home-types"
import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { PromptInput } from "./prompt-input"
import { ComposerInputCard } from "@/components/composer/composer-input-card"

function Example({
  docked = false,
  long = false,
  references = false,
}: {
  docked?: boolean
  long?: boolean
  references?: boolean
}) {
  const [value, setValue] = useState(
    references
      ? "请检查 @docs/首页验收说明.md "
      : long
        ? "下一步检查输入、工具调用和生成文件的完整流程。\n".repeat(20)
        : ""
  )
  const [materials, setMaterials] = useState<Material[]>(
    references ? [exampleMaterials[0]!] : []
  )
  const [count, setCount] = useState(0)
  return (
    <MaterialServiceContext.Provider value={exampleMaterialService}>
      <div className="p-6">
        <ComposerInputCard>
          <PromptInput
            variant={docked ? "docked" : "hero"}
            ariaLabel={docked ? "对话消息" : "工作需求"}
            materials={materials}
            cwd="H:/工作区/moon"
            onReferencesChanged={(text, removed, restored) => {
              setValue(text)
              setMaterials((items) => [
                ...items.filter((item) => !removed.includes(item.id)),
                ...restored,
              ])
            }}
            value={value}
            onChange={setValue}
            onSubmit={() => setCount((n) => n + 1)}
          />
        </ComposerInputCard>
        <p role="status">提交事件：{count}</p>
      </div>
    </MaterialServiceContext.Provider>
  )
}
export default {
  id: "prompt-input",
  name: "需求输入",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/prompt-input.tsx",
  description: "处理文本编辑、回车发送与输入法组合保护。",
  boundary:
    "必须位于 InputGroup 中；父级负责发送有效性，文本由父级持有；不隐式抢占焦点，使用点击或 Tab 进入。",
  inputs: [
    "value: 文本；materials/cwd持有引用；onReferencesChanged协调引用删除与撤销；inputRef为ComposerEditorElement，可由首页在新建/目录草稿回填后一次性安排焦点。正文所有断点14px/24px；hero最低52px，docked最低36px。",
  ],
  events: [
    "onChange(text)；onSubmit()，Shift+Enter保留换行；IME组合及尾窗、Alt/AltGraph、重复Enter不提交。",
  ],
  composition: [
    "ComposerEditor（Lexical plain text / history / ReferenceNode）",
  ],
  consumers: ["HomeComposer", "ConversationComposer"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "references",
      name: "正文内文件引用",
      condition: "实际材料引用与正文绑定，演示服务独立。",
      expected: "引用可点击预览；删除同步移除，撤销恢复；草稿文本继续编辑。",
      render: () => <Example references />,
    },
    {
      id: "editing",
      name: "编辑与快捷键",
      condition: "空文本，父级只记录提交事件。",
      expected: "可输入；Enter 增加事件计数，Shift+Enter 换行。",
      render: () => <Example />,
    },
    {
      id: "docked",
      name: "会话紧凑输入",
      condition: "同一输入组件使用 docked 变体。",
      expected: "最小正文 36px，文字 14px/24px；编辑和 IME 保护与首页一致。",
      render: () => <Example docked />,
    },
    {
      id: "long-docked",
      name: "会话长草稿",
      condition: "20行已保留文字。",
      expected: "正文增长到上限后局部滚动；内容完整、字号不因断点变化。",
      render: () => <Example docked long />,
    },
  ],
} satisfies CatalogEntry
