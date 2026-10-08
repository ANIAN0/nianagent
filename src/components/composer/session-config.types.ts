import { type ExtensionService } from "@/features/extensions/extension-service"

import type { ComposerTool, SessionOptions } from "@/lib/composer/types"

export type SessionConfigProps = {
  loading?: boolean
  extensionService?: ExtensionService
  disabled?: boolean
  disabledReason?: string
  sessionId?: string
  tools: ComposerTool[]
  value: SessionOptions
  workspacePath: string
  onChange: (value: SessionOptions) => void
}
