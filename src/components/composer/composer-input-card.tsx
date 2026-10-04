import type { ComponentProps } from "react"
import { FileUp } from "lucide-react"
import { InputGroup } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import "./composer-input-card.css"

export function ComposerInputCard({
  children,
  className,
  dropActive = false,
  dropDisabledReason,
  ...props
}: ComponentProps<typeof InputGroup> & {
  dropActive?: boolean
  dropDisabledReason?: string
}) {
  return (
    <InputGroup {...props} className={cn("moon-composer-input", className)}>
      {children}
      {dropActive && (
        <div className="moon-composer-drop" role="status">
          <FileUp className="size-6" />
          <span>{dropDisabledReason || "松开以添加附件"}</span>
        </div>
      )}
    </InputGroup>
  )
}
