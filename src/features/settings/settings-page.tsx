import { useCallback, useEffect, useRef, useState } from "react"
import {
  ModelSettingsContent,
  type ModelSettingsContentProps,
} from "@/features/models/model-settings-page"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { SettingsShell, type SettingsSection } from "./settings-shell"
import { StorageSettings } from "./storage-settings"
import { UpdateSettings } from "./update-settings"

export type SettingsPageProps = Omit<ModelSettingsContentProps, "section"> & {
  onReturn: () => void
  initialSection?: SettingsSection
}
export function SettingsPage({
  onReturn,
  registerLeave,
  initialSection = "models",
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
      {section === "updates" && <UpdateSettings />}
    </SettingsShell>
  )
}
