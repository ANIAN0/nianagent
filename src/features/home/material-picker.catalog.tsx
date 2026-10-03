import { useRef, useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { MaterialPicker } from "./material-picker"
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { homeData } from "../../../ui-catalog/fixtures/home"
import { MaterialServiceContext } from "@/features/materials/material-service"
import {
  exampleMaterialService,
  exampleMaterials,
} from "@/features/materials/material-catalog-fixtures"
function Example({ empty = false }: { empty?: boolean }) {
  const [selected, setSelected] = useState([homeData.materials[0]!])
  const [text, setText] = useState("")
  const anchorRef = useRef<HTMLDivElement>(null)
  return (
    <MaterialServiceContext.Provider
      value={
        empty
          ? {
              ...exampleMaterialService,
              catalog: async (_id, cwd) => ({
                cwd,
                files: [],
                skills: [],
                diagnostics: [],
              }),
            }
          : exampleMaterialService
      }
    >
      <div className="px-6 pt-[340px] pb-6">
        <InputGroup ref={anchorRef} className="rounded-2xl">
          <InputGroupTextarea
            aria-label="工作需求"
            placeholder="描述工作需求"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <InputGroupAddon align="block-end">
            <MaterialPicker
              anchorRef={anchorRef}
              materials={empty ? [] : homeData.materials}
              selected={selected}
              onAdd={(item) =>
                setSelected((items) =>
                  items.some((entry) => entry.id === item.id)
                    ? items
                    : [...items, item]
                )
              }
              onInsert={setText}
              onTextChange={setText}
              sessionId="catalog-example"
              workspacePath="H:/工作区/moon"
              onChooseAttachments={async () =>
                setSelected((items) => [...items, exampleMaterials[2]!])
              }
            />
          </InputGroupAddon>
        </InputGroup>
        <p role="status" className="mt-3 text-xs">
          已选：{selected.map((item) => item.name).join("、")}
        </p>
      </div>
    </MaterialServiceContext.Provider>
  )
}
export default {
  id: "material-picker",
  name: "材料候选面板",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/material-picker.tsx",
  description:
    "与输入卡同宽的向上候选面板，包含添加、Skills、提示模板和内置命令；引用资源进入搜索面板。",
  boundary:
    "草稿由父级保存；正式入口经原生多选与材料服务准备，@检索真实工作区，/选择Pi发现的Skill。目录注入独立服务替身，操作不访问用户数据或模型。",
  inputs: [
    "materials、selected；anchorRef: 输入卡锚点；onInsert 存在时展示模板与命令。",
  ],
  events: ["onAdd(material)、onInsert(text)。"],
  composition: ["InputGroup", "Button", "MaterialCandidateList"],
  consumers: ["ComposerToolbar", "ConversationComposer"],
  viewport: { width: 880, height: 580 },
  states: [
    {
      id: "disabled",
      name: "输入暂不可用",
      condition: "调用方正在提交或禁止修改当前草稿",
      expected: "入口禁用，不产生材料或修改输入",
      render: () => (
        <MaterialPicker
          disabled
          materials={[]}
          selected={[]}
          onAdd={() => {}}
        />
      ),
    },
    {
      id: "available",
      name: "候选与资源搜索",
      condition: "已有一个附件。",
      expected:
        "面板贴着卡片上沿；方向键定位，Enter选取；引用资源可搜索且已选项禁用。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无项目资源",
      condition: "材料列表为空。",
      expected: "仍可添加本地附件、使用模板；资源搜索显示空状态。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
