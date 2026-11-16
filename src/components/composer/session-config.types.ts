import type { ReactNode } from "react"
import type { ExtensionManagerSlotProps } from "@/lib/composer/session-config-port"
import type { ComposerTool, SessionOptions } from "@/lib/composer/types"

export type SessionConfigProps = {
  loading?: boolean
  renderExtensionManager?: (props: ExtensionManagerSlotProps) => ReactNode
  disabled?: boolean
  disabledReason?: string
  sessionId?: string
  tools: ComposerTool[]
  value: SessionOptions
  workspacePath: string
  onChange: (value: SessionOptions) => void
}
