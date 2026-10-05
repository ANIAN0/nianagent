import { PromptInput } from "./prompt-input"
import { ComposerInputCard } from "@/components/composer/composer-input-card"
import { useRef, useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { MaterialPicker } from "./material-picker"
import { ComposerPanelProvider } from "./composer-panel-context"
import { ModelPicker } from "./model-picker"
import { SessionConfig } from "./session-config"
import { SelectedMaterials } from "./selected-materials"
import type { Material, SessionOptions } from "./home-types"
import { cn } from "@/lib/utils"
import { InputGroupAddon } from "@/components/ui/input-group"
import { homeData } from "../../../ui-catalog/fixtures/home"
import { MaterialServiceContext } from "@/features/materials/material-service"
import {
  exampleMaterialService,
  exampleMaterials,
} from "@/features/materials/material-catalog-fixtures"
function Example({
  empty = false,
  failure = false,
  cancelled = false,
  compact = true,
  scrollBoundary = false,
  operations = false,
}: {
  empty?: boolean
  failure?: boolean
  cancelled?: boolean
  compact?: boolean
  scrollBoundary?: boolean
  operations?: boolean
}) {
  const [selected, setSelected] = useState<Material[]>([])
  const [text, setText] = useState("")
  const [model, setModel] = useState(homeData.models[0]!)
  const [thinking, setThinking] = useState("中")
  const [options, setOptions] = useState<SessionOptions>({
    toolIds: ["read"],
    instructionScope: "all",
  })
  const anchorRef = useRef<HTMLDivElement>(null)
  const [service] = useState(() => {
    let failedRead = false
    if (failure || cancelled)
      return {
        ...exampleMaterialService,
        catalog: async (
          ...args: Parameters<typeof exampleMaterialService.catalog>
        ) => {
          if (!failedRead) {
            failedRead = true
            if (cancelled) throw new DOMException("已取消读取", "AbortError")
            throw Object.assign(new Error("Skill 目录暂时无法读取。"), {
              issue: {
                code: "material_catalog_unavailable",
                summary: "Skill 目录暂时无法读取，请重新读取。",
                details: "资源发现暂不可用；已适配的内置命令仍可使用。",
                recovery: "retry",
                severity: "error",
              },
            })
          }
          return exampleMaterialService.catalog(...args)
        },
      }
    if (empty)
      return {
        ...exampleMaterialService,
        catalog: async (_id: string, cwd: string) => ({
          cwd,
          files: [],
          skills: [],
          diagnostics: [],
        }),
      }
    return exampleMaterialService
  })
  return (
    <MaterialServiceContext.Provider value={service}>
      <ComposerPanelProvider>
        <div
          className={cn("px-6 pb-6", scrollBoundary ? "pt-6" : "pt-[340px]")}
        >
          <ComposerInputCard ref={anchorRef}>
            <PromptInput
              ariaLabel="工作需求"
              value={text}
              onChange={setText}
              materials={selected}
              cwd="H:/工作区/moon"
              onReferencesChanged={(value, removed, restored) => {
                setText(value)
                setSelected((items) => [
                  ...items.filter((item) => !removed.includes(item.id)),
                  ...restored,
                ])
              }}
              onSubmit={() => {}}
            />
            <SelectedMaterials
              materials={selected}
              cwd="H:/工作区/moon"
              onRemove={(id) =>
                setSelected((items) => items.filter((item) => item.id !== id))
              }
            />
            <InputGroupAddon align="block-end">
              <MaterialPicker
                anchorRef={anchorRef}
                materials={empty ? [] : homeData.materials}
                selected={selected}
                allowCompact={compact}
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
              {operations && (
                <>
                  <div className="flex-1" />
                  <ModelPicker
                    models={homeData.models}
                    thinkingByModel={Object.fromEntries(
                      homeData.models.map((name) => [name, ["低", "中", "高"]])
                    )}
                    value={model}
                    thinking={thinking}
                    onChange={setModel}
                    onThinkingChange={setThinking}
                  />
                  <SessionConfig
                    tools={homeData.tools}
                    value={options}
                    workspacePath="H:/工作区/moon"
                    onChange={setOptions}
                  />
                </>
              )}
            </InputGroupAddon>
          </ComposerInputCard>
          <p role="status" className="mt-3 text-xs">
            已选：{selected.map((item) => item.name).join("、")}
          </p>
        </div>
      </ComposerPanelProvider>
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
    "贴输入卡可见上沿、与卡同宽；＋平铺附件/文件/Skill入口，@引用文件和目录、右箭头下钻，/仅显示已适配命令。",
  boundary:
    "草稿由父级保存；正式入口经原生多选与材料服务准备，@检索真实工作区，/选择Pi发现的Skill。目录注入独立服务替身，操作不访问用户数据或模型。",
  inputs: [
    "materials、selected；anchorRef: 输入卡锚点；allowCompact显式提供压缩命令，首页不提供。ComposerPanelProvider 协调同一输入框的操作层；独立预览无需 Provider。",
  ],
  events: [
    "onAdd(material)添加材料；onTextChange(text)替换当前查询或填写调用；onInsert为兼容的文本插入回调。",
  ],
  composition: [
    "InputGroup",
    "Button",
    "MaterialCandidateList",
    "ComposerPanelProvider",
  ],
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
      condition: "可添加本地附件或引用项目资源。",
      expected:
        "＋只显示添加附件与引用资源；资源按文件、Skills分组，选择后加入材料并返回输入。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无项目资源",
      condition: "材料列表为空。",
      expected:
        "仍可添加本地附件；资源搜索显示无可用资源，命令候选与资源状态独立。",
      render: () => <Example empty />,
    },
    {
      id: "file-reference",
      name: "@ 文件引用",
      condition: '在输入框输入 @ 后跟文件名，带空格的名称可使用 @" 查询。',
      expected:
        "只列工作区文件，选择仅替换当前 @ 查询（含包围引号）、保留其余文字与单一引用条目。",
      render: () => <Example compact={false} />,
    },
    {
      id: "skill-command",
      name: "/ Skill 与命令",
      condition: "输入 /；或输入 /skill: 指定 Skill 类别。",
      expected:
        "内置命令与 Skill 调用分组；选择 Skill 保留可见调用，/skill:不混入内置命令；选择不自动提交。",
      render: () => <Example />,
    },
    {
      id: "panel-switching",
      name: "材料／模型／配置切换",
      condition: "同一输入框先后打开＋、模型、思考与会话配置。",
      expected:
        "当前只保留一个操作层；旧层关闭不抢夺新层焦点，Escape 返回所属入口。",
      render: () => <Example operations />,
    },
    {
      id: "scrolled-card",
      name: "卡上沿滚出视口",
      condition: "滚动长输入至底部，再打开＋或引用资源；窄窗、短窗仍可操作。",
      expected:
        "面板四边保留12px安全间距；使用可见入口决定上下退避，搜索固定可达、候选局部滚动。",
      render: () => <Example scrollBoundary />,
    },
    {
      id: "caret-query",
      name: "查询随光标移动",
      condition:
        '输入 检查 @README；Home/End、鼠标和选择文字；或输入 @"中文 空格.md" 后移动至查询中。',
      expected:
        "离开查询即关闭，回到查询重新识别；替换完整当前 token 并保留后续正文；IME不误选或误发。",
      render: () => <Example compact={false} />,
    },
    {
      id: "resource-error",
      name: "资源读取失败可恢复",
      condition: "输入 / 时首次 Skill 目录读取失败。",
      expected:
        "错误属于 Skill 组，安全原因与诊断信息保留；压缩命令仍可选，重新读取恢复实际资源列表。",
      render: () => <Example failure />,
    },
    {
      id: "resource-cancelled",
      name: "资源读取取消可重读",
      condition: "输入 / 时当前 Skill 目录读取返回取消。",
      expected:
        "取消属于 Skill 组中性反馈，无红色错误；可重新读取，压缩命令仍支持点击及键盘选择。",
      render: () => <Example cancelled />,
    },
  ],
} satisfies CatalogEntry
