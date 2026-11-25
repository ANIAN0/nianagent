import { useCallback, useEffect, useRef } from "react"
import {
  ModelSettingsContent,
  type ModelSettingsContentProps,
} from "@/features/models/model-settings-page"
import { McpSettings } from "@/features/mcp/mcp-settings"
import type { McpService } from "@/features/mcp/mcp-service"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import type { Conversation } from "@/lib/composer/types"
import { SettingsShell, type SettingsSection } from "./settings-shell"
import { ArchivedConversationsSettings } from "./archived-conversations-settings"
import { ArchitectureSettings } from "./architecture-settings"
import { StorageSettings } from "./storage-settings"
import { DesignGuidelinesSettings } from "./design-guidelines-settings"
import { UpdateSettings } from "./update-settings"
import { GeneralSettings, type WorkspaceSettingsPort } from "./general-settings"

export type SettingsPageProps = Omit<ModelSettingsContentProps, "section"> & {
  mcpService?: McpService
  onReturn: () => void
  workspaces: WorkspaceSettingsPort
  pendingConversations: Conversation[]
  onOpenConversation: (id: string) => void
  onUnarchived?: () => void
  /** 受控分区：归属 App 持有，主导航与设置内导航由此保持同一事实。 */
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}
export function SettingsPage({
  onReturn,
  registerLeave,
  section,
  onSectionChange,
  mcpService,
  workspaces,
  pendingConversations,
  onOpenConversation,
  onUnarchived,
  ...models
}: SettingsPageProps) {
  const guard = useRef<LeaveGuard | null>(null)
  const register = useCallback((value: LeaveGuard | null) => {
    guard.current = value
  }, [])
  const leave = useCallback<LeaveGuard>((action) => {
    if (guard.current) guard.current(action)
    else action()
  }, [])
  useEffect(() => {
    registerLeave?.(leave)
    return () => registerLeave?.(null)
  }, [leave, registerLeave])
  return (
    <SettingsShell
      section={section}
      onReturn={onReturn}
      pendingConversations={pendingConversations}
      onOpenConversation={onOpenConversation}
      onSelect={(next) => {
        if (next !== section)
          leave(() => {
            guard.current = null
            onSectionChange(next)
          })
      }}
    >
      {section === "general" && <GeneralSettings workspaces={workspaces} />}
      {section === "archived" && (
        <ArchivedConversationsSettings
          onUnarchived={onUnarchived}
          onOpenConversation={onOpenConversation}
        />
      )}
      {section === "models" && (
        <ModelSettingsContent {...models} registerLeave={register} />
      )}
      {section === "mcp" && (
        <div className="h-full min-h-0" aria-label="入站 MCP 设置">
          <McpSettings service={mcpService} registerLeave={register} />
        </div>
      )}
      {section === "storage" && <StorageSettings registerLeave={register} />}
      {section === "guidelines" && <DesignGuidelinesSettings />}
      {section === "architecture" && <ArchitectureSettings />}
      {section === "updates" && <UpdateSettings registerLeave={register} />}
    </SettingsShell>
  )
}
