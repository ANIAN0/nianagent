import { useState } from "react"
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ToolPicker } from "./tool-picker"
import { InstructionScopePicker } from "./instruction-scope-picker"
import type { HomeTool, SessionOptions } from "./home-types"

export type SessionConfigProps = {
  tools: HomeTool[]
  value: SessionOptions
  workspacePath: string
  onChange: (value: SessionOptions) => void
}
export function SessionConfig({
  tools,
  value,
  workspacePath,
  onChange,
}: SessionConfigProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(value)
  const toolsChanged =
    pending.toolIds.length !== value.toolIds.length ||
    pending.toolIds.some((id) => !value.toolIds.includes(id))
  const scopeChanged = pending.instructionScope !== value.instructionScope
  const changed =
    pending.instructionScope !== value.instructionScope ||
    pending.toolIds.length !== value.toolIds.length ||
    pending.toolIds.some((id) => !value.toolIds.includes(id))
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPending({ ...value, toolIds: [...value.toolIds] })
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1 rounded-full font-normal"
          aria-label={`打开会话配置，已选 ${value.toolIds.length} 个工具`}
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden @sm:inline">会话配置</span>
          <ChevronDown className="size-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[500px] max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[600px] [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4">
        <DialogHeader className="px-6 pt-[18px] pb-2">
          <DialogTitle className="text-base leading-6">会话配置</DialogTitle>
          <DialogDescription className="sr-only">
            应用后用于这项新工作。当前工具与指令配置均为模拟数据。
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="tools" className="min-h-0 flex-1 gap-0 px-6">
          <TabsList
            variant="line"
            aria-label="会话配置分类"
            className="mb-4 w-full shrink-0 justify-start gap-6 border-b p-0 group-data-horizontal/tabs:h-9"
          >
            <TabsTrigger
              className="flex-none rounded-none px-0.5 text-[13px] font-normal group-data-horizontal/tabs:after:bottom-[-1px]"
              value="tools"
            >
              工具{" "}
              {toolsChanged && (
                <span
                  aria-label="已修改"
                  className="size-[5px] rounded-full bg-primary"
                />
              )}
            </TabsTrigger>
            <TabsTrigger
              className="flex-none rounded-none px-0.5 text-[13px] font-normal group-data-horizontal/tabs:after:bottom-[-1px]"
              value="instructions"
            >
              项目指令{" "}
              {scopeChanged && (
                <span
                  aria-label="已修改"
                  className="size-[5px] rounded-full bg-primary"
                />
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tools" className="min-h-0 pb-4">
            <ToolPicker
              tools={tools}
              value={pending.toolIds}
              onChange={(toolIds) =>
                setPending((current) => ({ ...current, toolIds }))
              }
            />
          </TabsContent>
          <TabsContent
            value="instructions"
            className="min-h-0 overflow-y-auto pb-4"
          >
            <InstructionScopePicker
              workspacePath={workspacePath}
              value={pending.instructionScope}
              onChange={(instructionScope) =>
                setPending((current) => ({ ...current, instructionScope }))
              }
            />
          </TabsContent>
        </Tabs>
        <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4">
          <DialogClose asChild>
            <Button type="button" variant="ghost" className="h-9 w-[72px]">
              取消
            </Button>
          </DialogClose>
          <Button
            type="button"
            className="h-9 w-[72px]"
            disabled={!changed}
            onClick={() => {
              onChange(pending)
              setOpen(false)
            }}
          >
            应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
