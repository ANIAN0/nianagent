import { GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
export function ForkAction({
  pending,
  disabledReason,
  onFork,
}: {
  pending?: boolean
  disabledReason?: string
  onFork: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={pending || disabledReason ? 0 : undefined}
          aria-label={disabledReason}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="在新会话中分支"
            disabled={pending || !!disabledReason}
            onClick={onFork}
          >
            <GitBranch />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {pending ? "正在创建分支" : disabledReason || "在新会话中分支"}
      </TooltipContent>
    </Tooltip>
  )
}
