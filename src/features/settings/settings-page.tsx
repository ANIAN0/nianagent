import { useCallback, useEffect, useRef } from "react"
import {
  ModelSettingsContent,
  type ModelSettingsContentProps,
} from "@/features/models/model-settings-page"
import { McpSettings } from "@/features/mcp/mcp-settings"
import type { McpService } from "@/features/mcp/mcp-service"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { SettingsShell, type SettingsSection } from "./settings-shell"
import { StorageSettings } from "./storage-settings"
import { UpdateSettings } from "./update-settings"
import "@/features/plugins/plugins.css"

export type SettingsPageProps = Omit<ModelSettingsContentProps, "section"> & {
  mcpService?: McpService
  onReturn: () => void
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
      onReturn={() => leave(onReturn)}
      onSelect={(next) => {
        if (next !== section)
          leave(() => {
            guard.current = null
            onSectionChange(next)
          })
      }}
    >
      {section === "models" && (
        <ModelSettingsContent {...models} registerLeave={register} />
      )}
      {section === "mcp" && (
        <div className="h-full min-h-0" aria-label="MCP 设置">
          <McpSettings service={mcpService} registerLeave={register} />
        </div>
      )}
      {section === "storage" && <StorageSettings />}
      {section === "updates" && <UpdateSettings />}
    </SettingsShell>
  )
}
