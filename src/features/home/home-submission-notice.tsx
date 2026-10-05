import type { ReactNode } from "react"
import { ComposerNotification } from "@/components/composer/composer-notification"
export function HomeSubmissionNotice({
  message,
  actions,
  persistent = false,
}: {
  message: string
  actions?: ReactNode
  persistent?: boolean
}) {
  return (
    <ComposerNotification
      message={message}
      actions={persistent ? actions : undefined}
      persistent={persistent}
    />
  )
}
