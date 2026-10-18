import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react"
import {
  ModelSettingsContent,
  type ModelSettingsContentProps,
} from "@/features/models/model-settings-page"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { SettingsShell, type SettingsSection } from "./settings-shell"
import { StorageSettings } from "./storage-settings"
import { UpdateSettings } from "./update-settings"
import { PluginSettings } from "@/features/plugins/plugin-settings"
import "@/features/plugins/plugins.css"
import { DeveloperToolsSettings } from "./developer-tools-settings"

export type SettingsPageProps = Omit<ModelSettingsContentProps, "section"> & {
  onReturn: () => void
  initialSection?: SettingsSection
  pluginManagement?: ComponentProps<typeof PluginSettings>
}
export function SettingsPage({
  onReturn,
  registerLeave,
  initialSection = "models",
  pluginManagement,
  ...models
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection)
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
            setSection(next)
          })
      }}
    >
      {(section === "models" || section === "mcp") && (
        <ModelSettingsContent
          key={section}
          {...models}
          section={section}
          registerLeave={register}
        />
      )}
      {section === "storage" && <StorageSettings />}
      {section === "plugins" && <PluginSettings {...pluginManagement} />}
      {section === "updates" && <UpdateSettings />}
      {section === "developer" && <DeveloperToolsSettings />}
    </SettingsShell>
  )
}
