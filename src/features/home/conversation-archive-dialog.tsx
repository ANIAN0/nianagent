import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { conversationIsRunning } from "./conversation-history-layout"
import type { Conversation } from "@/lib/composer/types"

/**
 * 归档确认；运行中的会话先经停止再归档，撤档不恢复被停止的工作。
 */
export function ConversationArchiveDialog({
  conversation,
  pending,
  issue,
  onConfirm,
  onClose,
}: {
  conversation: Conversation | null
  pending: boolean
  issue?: string
  onConfirm: (conversation: Conversation) => void
  onClose: () => void
}) {
  const running = !!conversation && conversationIsRunning(conversation)
  return (
    <Dialog
      open={!!conversation}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {running ? "停止并归档会话？" : "归档会话？"}
          </DialogTitle>
          <DialogDescription>
            {running
              ? conversation
                ? `「${conversation.title}」正在运行。停止当前运行后归档；已写入的消息和真实工具结果会保留。`
                : ""
              : conversation
                ? `「${conversation.title}」尚有待处理请求。处理请求后才可归档。`
                : ""}
          </DialogDescription>
        </DialogHeader>
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
          <Button
            type="button"
            disabled={pending}
            onClick={() => conversation && onConfirm(conversation)}
          >
            {pending ? "正在归档…" : running ? "停止并归档" : "归档"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
