import { useRef, useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { SelectedMaterials } from "./selected-materials"
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group"
import {
  MaterialServiceContext,
  type MaterialService,
} from "@/features/materials/material-service"
import {
  exampleMaterials,
  exampleMaterialService,
  sampleImageData,
} from "@/features/materials/material-catalog-fixtures"
import { useComposerMaterials } from "@/features/materials/use-composer-materials"
import type { Material } from "./home-types"

const longFile: Material = {
  ...exampleMaterials[0]!,
  id: "long",
  name: "这是一个很长的附件名称用于检查窄屏截断和移除按钮.md",
}

function Example({
  empty = false,
  many = false,
  mixed = false,
  unsupported = false,
}: {
  empty?: boolean
  many?: boolean
  mixed?: boolean
  unsupported?: boolean
}) {
  const [items, setItems] = useState<Material[]>(() =>
    empty
      ? []
      : many
        ? Array.from({ length: 12 }, (_, index) => ({
            ...exampleMaterials[0]!,
            id: `file-${index}`,
            name: `第${index + 1}份首页交互验收说明.md`,
            description: `docs/首页交互验收说明-${index + 1}.md`,
          }))
        : [
            exampleMaterials[0]!,
            exampleMaterials[1]!,
            ...(mixed || unsupported
              ? [
                  {
                    ...exampleMaterials[2]!,
                    thumbnail: `data:image/png;base64,${sampleImageData}`,
                    ...(unsupported
                      ? {
                          status: "failed" as const,
                          error: "当前模型不支持图片，请更换模型或移除。",
                        }
                      : {}),
                  },
                ]
              : []),
            longFile,
          ]
  )
  return (
    <MaterialServiceContext.Provider value={exampleMaterialService}>
      <div className="p-4">
        <InputGroup className="rounded-2xl">
          <InputGroupTextarea
            aria-label="材料所属输入区"
            placeholder="材料所属输入区"
          />
          <SelectedMaterials
            materials={items}
            onRemove={(id) =>
              setItems((current) => current.filter((item) => item.id !== id))
            }
          />
        </InputGroup>
        <p role="status">材料数：{items.length}</p>
      </div>
    </MaterialServiceContext.Provider>
  )
}

function RecoveryExample() {
  const [requests, setRequests] = useState({ restore: 0, prepare: 0 })
  const material: Material = {
    ...exampleMaterials[0]!,
    id: "a".repeat(64),
  }
  const [service] = useState<MaterialService>(() => ({
    ...exampleMaterialService,
    restore: async (_id, _cwd, values) => {
      setRequests((current) => ({ ...current, restore: current.restore + 1 }))
      return values.map((item) => ({
        ...item,
        type: item.type ?? "file",
        status: "failed",
        source: item.source ?? "",
        error: "目录暂时不可读，请恢复访问后重新检查。",
      }))
    },
    prepare: async () => {
      setRequests((current) => ({ ...current, prepare: current.prepare + 1 }))
      return [
        {
          ...material,
          type: "file",
          status: "ready",
          source: material.source!,
        },
      ]
    },
    preview: async () => ({
      id: material.id,
      name: material.name,
      source: material.source!,
      label: "当前文件",
      content: "# 恢复后的材料",
      mimeType: "",
      data: "",
      truncated: false,
    }),
  }))
  return (
    <MaterialServiceContext.Provider value={service}>
      <RecoveryInput initial={material} />
      <p role="status" className="px-4 text-xs">
        来源核对：{requests.restore} 次；手动准备：{requests.prepare} 次
      </p>
    </MaterialServiceContext.Provider>
  )
}

function RecoveryInput({ initial }: { initial: Material }) {
  const [items, setItems] = useState([initial])
  const anchorRef = useRef<HTMLDivElement>(null)
  const controller = useComposerMaterials({
    sessionId: "catalog-material-recovery",
    cwd: "H:/工作区/moon",
    anchorRef,
    materials: items,
    update: (apply) => setItems(apply),
  })
  return (
    <div className="p-4">
      <InputGroup ref={anchorRef} className="rounded-2xl">
        <InputGroupTextarea
          aria-label="材料所属输入区"
          placeholder="描述你要做的事…"
        />
        <SelectedMaterials
          materials={items}
          cwd="H:/工作区/moon"
          onRemove={(id) =>
            setItems((current) => current.filter((item) => item.id !== id))
          }
          onRetry={(id) => {
            void controller.retry(id)
          }}
          canRetry={(item) => controller.canRetry(item.id)}
          retryLabel={(item) => controller.retryLabel(item.id)}
        />
      </InputGroup>
      <p role="status" className="mt-2 text-xs">
        {items[0]?.id ?? "材料已移除"} · {items[0]?.status ?? "无材料"}
      </p>
    </div>
  )
}

export default {
  id: "selected-materials",
  name: "已选材料",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/selected-materials.tsx",
  description: "有界横向材料轨，承载附件/Skill 的预览、逐项恢复与移除。",
  boundary:
    "材料由草稿持有；嵌入InputGroup，空集合不占空间。正式页面通过材料服务准备和预览，目录没有生产连接。",
  inputs: [
    "materials: Material[]。",
    "canRetry(material)：仅对当前真实失败材料提供恢复，模型兼容性投影不能误重试。",
    "retryLabel(material)：区分重新核对与重试准备。",
  ],
  events: [
    "onRemove(id)：父级移除该材料。",
    "onRetry(id)：父级调用正式材料控制器，只重试该条目。",
  ],
  composition: [
    "InputGroupAddon",
    "AttachmentGroup",
    "MaterialChip",
    "Button（溢出滚动）",
    "MaterialPreviewDialog",
  ],
  consumers: ["HomeComposer", "ConversationComposer"],
  viewport: { width: 390, height: 420 },
  states: [
    {
      id: "populated",
      name: "材料与长名称",
      condition: "附件、Skill 及长名称。",
      expected: "可逐项移除，长名不挤出移除按钮。",
      render: () => <Example />,
    },
    {
      id: "many",
      name: "12份材料",
      condition: "窄窗超出一行",
      expected:
        "材料局部横向滚动；主输入不被挤走，左右/Home/End与Tab可查看全部条目。",
      render: () => <Example many />,
    },
    {
      id: "mixed",
      name: "混合图片",
      condition: "图片与文件、Skill同轨",
      expected: "图片为64px缩略图，轨道高度不超过72px。",
      render: () => <Example mixed />,
    },
    {
      id: "recovery",
      name: "逐项重新检查",
      condition:
        "来源恢复失败后手动重试，使用正式useComposerMaterials及隔离服务替身",
      expected: "只在点击后准备一次，保留同一材料ID，不追加副本、不自动循环。",
      render: () => <RecoveryExample />,
    },
    {
      id: "unsupported",
      name: "模型不支持图片",
      condition: "原材料可用，当前模型不支持图片",
      expected: "提供更换模型/移除提示，不把能力不匹配当材料准备失败反复重试。",
      render: () => <Example unsupported />,
    },
    {
      id: "empty",
      name: "无已选材料",
      condition: "空集合。",
      expected: "不显示材料区域。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
