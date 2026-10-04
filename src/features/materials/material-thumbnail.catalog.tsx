import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { AttachmentMedia } from "@/components/ui/attachment"
import { MaterialThumbnail } from "./material-thumbnail"
import { MaterialImagePreview } from "./material-image-preview"
import { sampleImageData } from "./material-catalog-fixtures"

export default {
  id: "material-thumbnail",
  name: "图片缩略图与解码状态",
  layer: "复合组件",
  group: "材料",
  source: "src/features/materials/material-thumbnail.tsx",
  description:
    "只呈现正式材料图片的加载、成功与失败状态；预览由所在卡片统一负责。",
  boundary:
    "状态展示使用正式组件，不读取磁盘；读取、解码与恢复组合可在消息附件的正式材料状态操作。",
  inputs: [
    "status: idle/loading/ready/failed",
    "url: 已解码生成的缩略图",
    "name",
  ],
  events: ["onError: 浏览器缩略图显示失败"],
  composition: ["AttachmentMedia", "MaterialThumbnail", "MaterialImagePreview"],
  consumers: ["MessageAttachments", "MaterialPreviewDialog"],
  viewport: { width: 500, height: 280 },
  states: [
    {
      id: "loading",
      name: "正在加载",
      condition: "正式缩略图请求已开始，尚未得到可解码字节",
      expected: "小图有加载图标与加载中文案，读屏说明具体材料，无成功缩略图。",
      render: () => (
        <div className="p-6">
          <AttachmentMedia variant="image">
            <MaterialThumbnail name="工具截图.png" status="loading" />
          </AttachmentMedia>
        </div>
      ),
    },
    {
      id: "failed",
      name: "缩略图失败",
      condition: "正式预览请求、字节解码或缩略图生成失败",
      expected: "明确加载失败；不在媒体区域嵌重复重试按钮，卡片负责受控预览。",
      render: () => (
        <div className="p-6">
          <AttachmentMedia variant="image">
            <MaterialThumbnail name="工具截图.png" status="failed" />
          </AttachmentMedia>
        </div>
      ),
    },
    {
      id: "ready",
      name: "缩略图成功",
      condition: "解码成功得到有界本地缩略图",
      expected: "正常显示图片，不把已成功解码的图片误判为失败。",
      render: () => (
        <div className="p-6">
          <AttachmentMedia variant="image">
            <MaterialThumbnail
              name="工具截图.png"
              status="ready"
              url={`data:image/png;base64,${sampleImageData}`}
            />
          </AttachmentMedia>
        </div>
      ),
    },
    {
      id: "preview-empty",
      name: "图片预览缺少内容",
      condition: "正式预览返回没有图片字节或不受支持的类型",
      expected: "说明无法解码并重新选择有效图片，不显示空正文或无止境加载。",
      render: () => (
        <div className="p-6">
          <MaterialImagePreview
            name="缺少内容.png"
            mimeType="image/png"
            data=""
          />
        </div>
      ),
    },
    {
      id: "preview-corrupt",
      name: "图片预览解码失败",
      condition: "正式预览返回损坏的PNG字节",
      expected: "浏览器解码失败后显示恢复说明，不显示破图或反复重试。",
      render: () => (
        <div className="p-6">
          <MaterialImagePreview
            name="损坏内容.png"
            mimeType="image/png"
            data="invalid"
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
