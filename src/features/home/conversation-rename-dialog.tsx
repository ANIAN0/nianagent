import { useRef } from "react"
import { useComposerKeyboard } from "@/components/composer/composer-keymap"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { Conversation } from "@/lib/composer/types"

/** 会话重命名；提交走与消息输入相同的 IME 守卫，失败保留对话框可重试。 */
export function ConversationRenameDialog({
  conversation,
  pending,
  issue,
  onRename,
  onClose,
}: {
  conversation: Conversation | null
  pending: boolean
  issue?: string
  onRename: (conversation: Conversation, title: string) => void
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const submit = () => {
    if (!conversation || pending) return
    const title = input.current?.value.trim() ?? ""
    if (!title) {
      input.current?.focus()
      return
    }
    onRename(conversation, title)
  }
  const keyboard = useComposerKeyboard<HTMLInputElement>(submit)
  return (
    <Dialog
      open={!!conversation}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => {
            input.current?.focus()
            input.current?.select()
          })
        }}
      >
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
          <DialogDescription>
            {conversation ? `「${conversation.title}」` : ""}
          </DialogDescription>
        </DialogHeader>
        <Input
          key={conversation?.id ?? "empty"}
          ref={input}
          defaultValue={conversation?.title ?? ""}
          disabled={pending}
          aria-label="会话名称"
          onKeyDown={(event) => {
            const intent = keyboard.onKeyDown(event)
            if (intent === "composing" || intent === "ignore") return
            if (intent === "newline") {
              // 单行标题不接受换行，与 Enter 同义提交。
              event.preventDefault()
              submit()
            }
          }}
          onCompositionStart={keyboard.onCompositionStart}
          onCompositionEnd={keyboard.onCompositionEnd}
        />
        {issue && (
          <p role="alert" className="text-sm text-destructive">
            {issue}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? "正在保存…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
