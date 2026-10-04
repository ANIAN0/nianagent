import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { MessageAttachments } from "./message-attachments"
import { sampleImageData } from "@/features/materials/material-catalog-fixtures"
import { useState } from "react"
import type { Material } from "@/features/home/home-types"
import type { MaterialPreview } from "@/features/models/model-contract.generated"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import {
  MaterialServiceContext,
  type MaterialService,
} from "@/features/materials/material-service"
import { exampleMaterialService } from "@/features/materials/material-catalog-fixtures"

function PreparedImageExample({
  mode,
}: {
  mode: "ready" | "loading" | "request-failed" | "decode-failed"
}) {
  const cwd = "H:/工作区/moon"
  const material: Material = {
    id: "catalog-history-image",
    name: "工具结果截图.png",
    kind: "附件",
    type: "image",
    status: "ready",
    source: "发送时的图片",
    mimeType: "image/png",
  }
  const [active, setActive] = useState<Material | null>(null)
  const [service] = useState<MaterialService>(() => ({
    ...exampleMaterialService,
    preview: async (_cwd, id, signal) => {
      if (mode === "loading")
        return new Promise<MaterialPreview>((_, reject) => {
          const abort = () =>
            reject(new DOMException("Cancelled", "AbortError"))
          if (signal?.aborted) abort()
          else signal?.addEventListener("abort", abort, { once: true })
        })
      if (mode === "request-failed")
        throw Object.assign(new Error("保存图片已不可用。"), {
          issue: {
            code: "material_unavailable",
            summary: "保存图片已不可用，请重新选择。",
            severity: "warning",
            recovery: "none",
          },
        })
      return {
        id,
        name: material.name,
        source: material.source!,
        label: "发送时的图片",
        content: "",
        mimeType: "image/png",
        data: mode === "decode-failed" ? "invalid" : sampleImageData,
        truncated: false,
      }
    },
  }))
  return (
    <MaterialServiceContext.Provider value={service}>
      <div className="p-6">
        <MessageAttachments
          cwd={cwd}
          attachments={[{ ...material, kind: "image", materialType: "image" }]}
          onOpenAttachment={() => setActive(material)}
        />
        <MaterialPreviewDialog
          cwd={cwd}
          material={active}
          history
          onClose={() => setActive(null)}
        />
      </div>
    </MaterialServiceContext.Provider>
  )
}
export default {
  id: "conversation-message-attachments",
  name: "消息附件",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/message-attachments.tsx",
  description:
    "已发送的文件、Skill和图片，提供可聚焦的预览入口；正式图片按可见性读取并区分加载、成功与失败。",
  boundary:
    "没有内容时明确说明；图片失败不自动重复读取，整个卡片打开受控预览；演示服务不读本地磁盘。",
  inputs: ["attachments: MessageAttachment[]"],
  events: ["onOpenAttachment(attachment)"],
  composition: [
    "Attachment",
    "MaterialThumbnail",
    "MaterialPreviewDialog",
    "Dialog",
  ],
  consumers: [
    "UserMessage",
    "AssistantMessage",
    "ToolCall",
    "ConversationTurnView",
  ],
  viewport: { width: 700, height: 460 },
  states: [
    {
      id: "prepared-image-ready",
      name: "正式材料图片成功",
      condition: "按正式材料标识读取PNG图片并解码",
      expected: "正常显示缩略图；点击整个卡片显示发送时图片，关闭恢复焦点。",
      render: () => <PreparedImageExample mode="ready" />,
    },
    {
      id: "prepared-image-loading",
      name: "正式材料图片加载中",
      condition: "已进入可视区，正式材料读取尚未完成",
      expected: "显示加载中，不用静态图片图标冒充完成；离开状态取消请求。",
      render: () => <PreparedImageExample mode="loading" />,
    },
    {
      id: "prepared-image-request-failed",
      name: "正式材料读取失败",
      condition: "保存图片不可用，后端恢复策略为none",
      expected:
        "显示加载失败；点击卡片显示明确来源问题和重新选择说明，无虚假重试。",
      render: () => <PreparedImageExample mode="request-failed" />,
    },
    {
      id: "prepared-image-decode-failed",
      name: "正式材料解码失败",
      condition: "正式预览接口返回损坏的PNG字节",
      expected:
        "缩略图失败；点击预览也显示解码失败说明，不显示破图、不无限加载。",
      render: () => <PreparedImageExample mode="decode-failed" />,
    },
    {
      id: "mixed",
      name: "混合附件与长文件名",
      condition: "图片和文本文件并列",
      expected: "图片64px，长文件名省略但悬停可读，文本和图片均可预览。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "image",
                name: "示例图片.png",
                kind: "image",
                url: `data:image/png;base64,${sampleImageData}`,
              },
              {
                id: "long",
                name: "会话页面设计评审与交互验收记录-2026-10-02.md",
                kind: "file",
                bytes: 2380,
                content: "# 验收记录\n\n检查消息布局、附件预览和中断反馈。",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "image-failed",
      name: "图片无法读取",
      condition: "图片内容损坏",
      expected: "明确显示加载失败，预览中同样显示失败反馈。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "broken",
                name: "无法读取的截图.png",
                kind: "image",
                url: "data:image/png;base64,invalid",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "file",
      name: "文本附件",
      condition: "有预览文本",
      expected: "打开显示原文，关闭恢复焦点。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "doc",
                name: "README.md",
                kind: "file",
                bytes: 1200,
                content: "# Moon\n\n本地 Agent 工作入口。",
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "metadata",
      name: "仅名称",
      condition: "没有文件内容",
      expected: "明确说明没有可预览内容。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              { id: "doc", name: "界面评审记录.pdf", kind: "file" },
            ]}
          />
        </div>
      ),
    },
    {
      id: "image",
      name: "图片预览",
      condition: "本地已有图片地址",
      expected: "显示图片缩略图和完整预览。",
      render: () => (
        <div className="p-6">
          <MessageAttachments
            attachments={[
              {
                id: "image",
                name: "示例图片.png",
                kind: "image",
                url: `data:image/png;base64,${sampleImageData}`,
              },
            ]}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
