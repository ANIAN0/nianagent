import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { MaterialPreviewDialog } from "./material-preview"
import { MaterialServiceContext } from "./material-service"
import {
  exampleMaterials,
  exampleMaterialService,
} from "./material-catalog-fixtures"

function Example({
  index = 0,
  failure,
}: {
  index?: number
  failure?:
    "unavailable" | "cancelled" | "restart" | "none" | "decode" | "empty"
}) {
  const [open, setOpen] = useState(false)
  const [service] = useState(() => {
    let reads = 0
    return {
      ...exampleMaterialService,
      preview: async (
        ...args: Parameters<typeof exampleMaterialService.preview>
      ) => {
        reads++
        if (reads === 1 && failure === "cancelled")
          throw new DOMException("已取消读取", "AbortError")
        if (failure === "restart" || failure === "none")
          throw Object.assign(new Error("材料预览尚不可用。"), {
            issue: {
              code:
                failure === "restart" ? "host_version" : "material_unavailable",
              summary:
                failure === "restart"
                  ? "Moon 服务已更新，需要重新启动应用。"
                  : "此材料记录无法恢复，请重新选择来源。",
              recovery: failure,
              severity: "warning",
            },
          })
        if (reads === 1 && failure === "unavailable")
          throw Object.assign(new Error("材料暂时无法读取，请重新读取。"), {
            issue: {
              code: "material_unavailable",
              summary: "材料暂时无法读取，请重新读取。",
              details:
                "演示：材料来源暂时被占用；重新读取只刷新此预览，不新增引用或发送消息。",
              recovery: "retry",
              severity: "error",
            },
          })
        const preview = await exampleMaterialService.preview(...args)
        return failure === "decode" || failure === "empty"
          ? { ...preview, data: failure === "decode" ? "invalid" : "" }
          : preview
      },
    }
  })
  const item = exampleMaterials[index]!
  return (
    <MaterialServiceContext.Provider value={service}>
      <div className="p-6">
        <Button variant="outline" onClick={() => setOpen(true)}>
          预览 {item.name}
        </Button>
        <MaterialPreviewDialog
          material={open ? item : null}
          cwd="H:/工作区/moon"
          onClose={() => setOpen(false)}
        />
      </div>
    </MaterialServiceContext.Provider>
  )
}
export default {
  id: "material-preview",
  name: "材料内容预览",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/materials/material-preview.tsx",
  description: "当前文件、准备的 Skill 正文及固定图片使用同一正式预览。",
  boundary:
    "通过 MaterialServiceContext 读取；目录注入稳定独立服务，真实页面读取 Moon 材料服务；关闭取消旧读取，恢复只刷新当前预览，不新增引用或自动发送。",
  inputs: ["material/cwd/history；材料身份与来源决定预览对象。"],
  events: [
    "onClose；结构化失败按RecoveryAction执行；restart只提供重启指导、none不伪造重读；取消使用中性反馈。",
  ],
  composition: [
    "Dialog、OperationFeedback、RecoveryAction、MaterialImagePreview",
  ],
  consumers: ["SelectedMaterials、LiveConversationView"],
  viewport: { width: 900, height: 700 },
  states: [
    {
      id: "file",
      name: "当前文件",
      condition: "普通文件路径引用",
      expected: "显示当前文件与来源，不称发送时版本。",
      render: () => <Example />,
    },
    {
      id: "skill",
      name: "准备的 Skill",
      condition: "准备过的 Skill 正文",
      expected: "正文和来源可核对。",
      render: () => <Example index={1} />,
    },
    {
      id: "image",
      name: "固定图片",
      condition: "已保存图片内容",
      expected: "图片保持比例、无重复读取源文件。",
      render: () => <Example index={2} />,
    },
    {
      id: "image-decode-failed",
      name: "图片解码失败",
      condition: "材料读取成功，但保存的PNG字节已损坏。",
      expected:
        "显示无法解码与重新选择说明，保留名称和来源；不显示破图或机械重试按钮。",
      render: () => <Example index={2} failure="decode" />,
    },
    {
      id: "image-empty",
      name: "图片内容缺失",
      condition: "图片材料读取结果没有图片字节。",
      expected: "显示设计过的无法显示反馈，不把空字节当作空文本或持续加载。",
      render: () => <Example index={2} failure="empty" />,
    },
    {
      id: "error",
      name: "读取失败与详情",
      condition: "首次读取返回结构化材料问题，重读恢复。",
      expected:
        "保留名称与来源，安全原因、详情和重读只有一处；重读不新增材料或发送。",
      render: () => <Example failure="unavailable" />,
    },
    {
      id: "cancelled",
      name: "读取取消与恢复",
      condition: "当前首次读取返回 AbortError/recovery:none。",
      expected:
        "显示中性取消说明，保留名称与来源；不伪造重试，关闭后可重新打开读取。",
      render: () => <Example failure="cancelled" />,
    },
    {
      id: "restart",
      name: "宿主需要重启",
      condition: "结构化恢复动作为restart。",
      expected: "显示重启指导，不能点击无效重读；预览仍可关闭。",
      render: () => <Example failure="restart" />,
    },
    {
      id: "none",
      name: "来源不可恢复",
      condition: "结构化恢复动作为none。",
      expected: "说明重新选择来源，保留名称与来源；不自动重新请求。",
      render: () => <Example failure="none" />,
    },
  ],
} satisfies CatalogEntry
