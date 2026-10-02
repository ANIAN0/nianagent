import { useState } from "react"
import { FileText, X } from "lucide-react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Button } from "./button"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "./attachment"
function Example({ error = false }: { error?: boolean }) {
  const [removed, setRemoved] = useState(false)
  const [opened, setOpened] = useState(false)
  return (
    <div className="flex flex-col gap-3 p-4">
      {!removed ? (
        <AttachmentGroup>
          <Attachment state={error ? "error" : "done"}>
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>README.md</AttachmentTitle>
              <AttachmentDescription>
                {error ? "读取失败" : "Markdown · 2 KB"}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentTrigger
              aria-label="查看 README.md"
              onClick={() => setOpened(true)}
            />
            <AttachmentActions>
              <AttachmentAction
                aria-label="移除 README.md"
                onClick={() => setRemoved(true)}
              >
                <X />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        </AttachmentGroup>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setRemoved(false)
            setOpened(false)
          }}
        >
          重置附件
        </Button>
      )}
      {opened && !removed && (
        <p role="status">已选择 README.md，预览事件由宿主处理。</p>
      )}
    </div>
  )
}
export default {
  id: "attachment",
  name: "附件容器",
  layer: "基础组件",
  group: "对话基础",
  source: "src/components/ui/attachment.tsx",
  description: "文件、图片等材料的媒体、名称、状态及操作组合。",
  boundary: "不上传或读取本地文件，触发器事件由宿主处理。",
  inputs: [
    "state：idle / uploading / processing / error / done。",
    "size：default / sm / xs；orientation：horizontal / vertical。",
  ],
  events: ["AttachmentTrigger 触发查看，AttachmentAction 触发移除等操作。"],
  composition: [
    "AttachmentGroup、Attachment、AttachmentMedia、AttachmentContent、AttachmentTitle、AttachmentDescription、AttachmentTrigger、AttachmentActions、AttachmentAction",
  ],
  consumers: ["MessageAttachments"],
  viewport: { width: 520, height: 220 },
  states: [
    {
      id: "file",
      name: "文件及操作",
      condition: "可查看、移除的文件。",
      expected: "点击查看显示事件结果；移除按钮独立操作且能重置。",
      render: () => <Example />,
    },
    {
      id: "error",
      name: "读取失败",
      condition: "state=error。",
      expected: "边框、图标和说明体现失败。",
      render: () => <Example error />,
    },
    {
      id: "sizes",
      name: "紧凑尺寸",
      condition: "三种尺寸并列。",
      expected: "尺寸缩小但名称仍可读。",
      render: () => (
        <AttachmentGroup>
          {(["default", "sm", "xs"] as const).map((size) => (
            <Attachment key={size} size={size}>
              <AttachmentMedia>
                <FileText />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{size}.md</AttachmentTitle>
                <AttachmentDescription>2 KB</AttachmentDescription>
              </AttachmentContent>
            </Attachment>
          ))}
        </AttachmentGroup>
      ),
    },
    {
      id: "pending",
      name: "处理中",
      condition: "state=processing。",
      expected: "显示处理说明，不假定完成。",
      render: () => (
        <Attachment state="processing" orientation="vertical">
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>设计规范.md</AttachmentTitle>
            <AttachmentDescription>正在处理</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      ),
    },
  ],
} satisfies CatalogEntry
