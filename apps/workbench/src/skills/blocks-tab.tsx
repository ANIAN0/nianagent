"use client"

import { useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  FileCode2,
  History,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Textarea } from "@/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group"
import type { SkillDetail } from "./api"

export function BlocksTab({
  detail,
  onAddBlock,
  onUpdateBlock,
  onDeleteBlock,
  onMoveBlock,
  onOpenLineage,
  onSaveAsset,
  onDeleteAsset,
}: {
  detail: SkillDetail
  onAddBlock: (payload: {
    heading: string
    content: string
    reason: string
  }) => Promise<boolean>
  onUpdateBlock: (
    blockId: string,
    payload: {
      heading: string
      content: string
      reason: string
    }
  ) => Promise<boolean>
  onDeleteBlock: (blockId: string) => void
  onMoveBlock: (index: number, delta: -1 | 1) => void
  onOpenLineage: (blockId: string) => void
  onSaveAsset: (payload: {
    relPath: string
    content: string
    reason: string
  }) => Promise<boolean>
  onDeleteAsset: (relPath: string) => void
}) {
  const [addingBlock, setAddingBlock] = useState(false)
  const [addHeading, setAddHeading] = useState("")
  const [addContent, setAddContent] = useState("")
  const [addReason, setAddReason] = useState("")

  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [editHeading, setEditHeading] = useState("")
  const [editContent, setEditContent] = useState("")
  const [editReason, setEditReason] = useState("")

  const [rightPane, setRightPane] = useState<"assets" | "preview">("assets")
  const [assetPath, setAssetPath] = useState("")
  const [assetContent, setAssetContent] = useState("")
  const [assetReason, setAssetReason] = useState("")

  const submitAddBlock = async () => {
    const ok = await onAddBlock({
      heading: addHeading,
      content: addContent,
      reason: addReason,
    })
    if (ok) {
      setAddingBlock(false)
      setAddHeading("")
      setAddContent("")
      setAddReason("")
    }
  }

  const submitEditBlock = async (blockId: string) => {
    const ok = await onUpdateBlock(blockId, {
      heading: editHeading,
      content: editContent,
      reason: editReason,
    })
    if (ok) {
      setEditingBlockId(null)
      setEditReason("")
    }
  }

  const submitSaveAsset = async () => {
    const ok = await onSaveAsset({
      relPath: assetPath,
      content: assetContent,
      reason: assetReason || "更新附属文件",
    })
    if (ok) {
      setAssetReason("")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      {/* 段落编排区 */}
      <section className="min-w-0 flex-1 overflow-y-auto p-5 lg:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              自包含段落
            </h2>
            {detail.skill.description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {detail.skill.description}
              </p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 gap-1 px-3 text-xs"
            onClick={() => setAddingBlock(true)}
          >
            <Plus className="size-3.5" />
            新增段落
          </Button>
        </div>

        {addingBlock && (
          <div className="mb-4 rounded-xl border border-primary/40 bg-card p-4">
            <div className="mb-2.5 text-xs font-medium text-foreground">
              新增自包含段落
            </div>
            <div className="space-y-2">
              <Input
                value={addHeading}
                onChange={(e) => setAddHeading(e.target.value)}
                placeholder="段落小标题（可选，如：前置校验规则）"
                className="h-8 text-xs"
              />
              <Textarea
                value={addContent}
                onChange={(e) => setAddContent(e.target.value)}
                rows={4}
                placeholder="输入这段话的 Markdown 内容…"
                className="font-mono text-xs"
              />
              <Input
                value={addReason}
                onChange={(e) => setAddReason(e.target.value)}
                placeholder="变更原因（必填，用于版本溯源）"
                className="h-8 text-xs"
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setAddingBlock(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void submitAddBlock()}
              >
                确认加入
              </Button>
            </div>
          </div>
        )}

        {detail.blocks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            暂无段落。点击右上角「新增段落」，或在 Moon 对话中调用工作台工具写入。
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {detail.blocks.map((blk, idx) => {
              const editing = editingBlockId === blk.id
              return (
                <div
                  key={blk.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                        #{idx + 1}
                      </span>
                      {blk.heading && (
                        <span className="truncate text-xs font-semibold text-foreground">
                          {blk.heading}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={idx === 0}
                        onClick={() => onMoveBlock(idx, -1)}
                        aria-label="上移"
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={idx === detail.blocks.length - 1}
                        onClick={() => onMoveBlock(idx, 1)}
                        aria-label="下移"
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="gap-1 text-muted-foreground"
                        onClick={() => onOpenLineage(blk.id)}
                      >
                        <History className="size-3" />
                        溯源
                      </Button>
                      {!editing && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="gap-1 text-primary"
                          onClick={() => {
                            setEditingBlockId(blk.id)
                            setEditHeading(blk.heading)
                            setEditContent(blk.content)
                            setEditReason("")
                          }}
                        >
                          <Pencil className="size-3" />
                          编辑
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => onDeleteBlock(blk.id)}
                        aria-label="删除段落"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {editing ? (
                    <div className="mt-2 space-y-2 border-t border-border pt-3">
                      <Input
                        value={editHeading}
                        onChange={(e) => setEditHeading(e.target.value)}
                        placeholder="段落标题（可选）"
                        className="h-8 text-xs"
                      />
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={5}
                        className="font-mono text-xs"
                      />
                      <Input
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="本次修改原因（必填）"
                        className="h-8 text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setEditingBlockId(null)}
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void submitEditBlock(blk.id)}
                        >
                          保存修改
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap wrap-anywhere font-mono text-xs leading-relaxed text-foreground/85">
                      {blk.content}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 右侧栏：附属文件与编译预览 */}
      <aside className="flex w-full shrink-0 flex-col border-t border-border bg-card lg:w-[380px] lg:border-t-0 lg:border-l xl:w-[420px]">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
          <ToggleGroup
            type="single"
            value={rightPane}
            onValueChange={(value) => {
              if (value === "assets" || value === "preview") {
                setRightPane(value)
              }
            }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <ToggleGroupItem value="assets" className="h-8 flex-1 text-xs">
              附属文件
            </ToggleGroupItem>
            <ToggleGroupItem value="preview" className="h-8 flex-1 text-xs">
              SKILL.md 预览
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {rightPane === "assets" ? (
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {detail.assets.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1.5">
                {detail.assets.map((a) => {
                  const selected = assetPath === a.relPath
                  return (
                    <div
                      key={a.id}
                      className={`inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md border pl-2 pr-1 text-xs ${
                        selected
                          ? "border-primary/40 bg-accent text-accent-foreground"
                          : "border-border bg-muted/50 text-foreground"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setAssetPath(a.relPath)
                          setAssetContent(a.content)
                        }}
                        className="inline-flex min-w-0 items-center gap-1 font-mono"
                        title={a.relPath}
                      >
                        <FileCode2 className="size-3 shrink-0" />
                        <span className="truncate">{a.relPath}</span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (assetPath === a.relPath) {
                            setAssetPath("")
                            setAssetContent("")
                          }
                          onDeleteAsset(a.relPath)
                        }}
                        aria-label={`删除 ${a.relPath}`}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
            <Input
              value={assetPath}
              onChange={(e) => setAssetPath(e.target.value)}
              placeholder="相对路径，如 scripts/validate.py"
              className="h-8 font-mono text-xs"
            />
            <Textarea
              value={assetContent}
              onChange={(e) => setAssetContent(e.target.value)}
              rows={12}
              placeholder="脚本或参考文件内容…"
              className="flex-1 font-mono text-xs"
            />
            <Input
              value={assetReason}
              onChange={(e) => setAssetReason(e.target.value)}
              placeholder="变更原因（如：补充校验脚本）"
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => void submitSaveAsset()}
            >
              保存附属文件
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
              {detail.compiledMd}
            </pre>
          </div>
        )}
      </aside>
    </div>
  )
}
