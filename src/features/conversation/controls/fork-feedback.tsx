import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
export function ForkFeedback({
  operation,
  error,
  onCheck,
  onOpen,
}: {
  operation: ConversationControlOperation
  error?: string
  onCheck: () => void
  onOpen?: (id: string) => void
}) {
  return (
    <Alert variant={error || operation.error ? "destructive" : "default"}>
      <AlertDescription>
        {error ||
          operation.error ||
          (operation.status === "completed"
            ? "已创建独立会话分支。"
            : "正在创建会话分支…")}
        {operation.status === "unknown" && (
          <Button variant="link" size="sm" onClick={onCheck}>
            检查分支状态
          </Button>
        )}
        {operation.status === "completed" &&
          operation.targetSessionId &&
          onOpen && (
            <Button
              variant="link"
              size="sm"
              onClick={() => onOpen(operation.targetSessionId!)}
            >
              打开分支
            </Button>
          )}
      </AlertDescription>
    </Alert>
  )
}
