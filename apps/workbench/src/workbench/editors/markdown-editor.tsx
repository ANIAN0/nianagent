"use client"

import { useState } from "react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Textarea } from "@/ui/textarea"

export function MarkdownEditor({
  initialMarkdown,
  saving,
  onSave,
  onCancel,
}: {
  initialMarkdown: string
  saving: boolean
  onSave: (markdown: string, summary: string) => Promise<void>
  onCancel: () => void
}) {
  const [content, setContent] = useState(initialMarkdown)
  const [summary, setSummary] = useState("")

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-5 py-2.5">
        <Input
          aria-label="版本说明"
          placeholder="版本更新说明（可选）…"
          className="h-8 max-w-xs text-xs"
          value={summary}
          disabled={saving}
          onChange={(event) => setSummary(event.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !content.trim()}
            onClick={() => void onSave(content, summary.trim())}
          >
            {saving ? "发布中…" : "发布新版本"}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex h-full max-w-3xl flex-col">
          <Textarea
            aria-label="Markdown 正文编辑"
            className="min-h-[420px] flex-1 resize-none border bg-card p-4 font-mono text-sm leading-relaxed"
            placeholder="# 标题&#10;&#10;在此输入 Markdown 内容…"
            value={content}
            disabled={saving}
            onChange={(event) => setContent(event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
