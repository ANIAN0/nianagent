import { useCallback, useRef, useState } from "react"
import { profileLocalStorage as localStorage } from "@/lib/rpc/profile-storage"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import type { useNavigationBoundaryState } from "@/lib/navigation/navigation-boundary"
import type { SettingsSection } from "@/features/settings/settings-shell"

const selectedKey = "moon.conversation.selected.v1"

function restoreSelection() {
  try {
    return localStorage.getItem(selectedKey) || undefined
  } catch {
    return undefined
  }
}

export type AppNavigationHooks = {
  onBeforeNavigate?: () => void
  onSelectConversation?: () => void
}

/** 顶层互斥视图：会话工作台 / 设置 / 插件工作台。 */
export type AppView = "conversation" | "settings" | "plugins"

export function useAppNavigation(
  navigation: ReturnType<typeof useNavigationBoundaryState>,
  hooksRef?: React.MutableRefObject<AppNavigationHooks>
) {
  const [view, setView] = useState<AppView>("conversation")
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general")
  const [selected, setSelected] = useState<string | undefined>(restoreSelection)
  const settingsGuard = useRef<LeaveGuard | null>(null)

  const registerSettingsLeave = useCallback((guard: LeaveGuard | null) => {
    settingsGuard.current = guard
  }, [])

  // 进入新视图须先过设置页的未保存修改守卫；从会话进入互不拦截。
  const enterView = useCallback(
    (next: AppView, section?: SettingsSection) => {
      const enter = () => {
        hooksRef?.current.onBeforeNavigate?.()
        setView(next)
        if (section) setSettingsSection(section)
      }
      if (view === "settings" && settingsGuard.current)
        settingsGuard.current(enter)
      else enter()
    },
    [hooksRef, view]
  )

  const openSettings = useCallback(() => {
    enterView("settings", "models")
  }, [enterView])

  const openGeneralSettings = useCallback(() => {
    enterView("settings", "general")
  }, [enterView])

  const openArchivedSettings = useCallback(() => {
    enterView("settings", "archived")
  }, [enterView])

  const openUpdateSettings = useCallback(() => {
    enterView("settings", "updates")
  }, [enterView])

  const openPlugins = useCallback(() => {
    enterView(view === "plugins" ? "conversation" : "plugins")
  }, [enterView, view])

  const leaveSettings = useCallback(
    (action: () => void) => {
      navigation.run(() => {
        const leave = () =>
          navigation.run(() => {
            setView("conversation")
            action()
          })
        if (view === "settings" && settingsGuard.current)
          settingsGuard.current(leave)
        else leave()
      })
    },
    [navigation, view]
  )

  const selectConversation = useCallback(
    (id?: string) => {
      hooksRef?.current.onBeforeNavigate?.()
      setSelected(id)
      hooksRef?.current.onSelectConversation?.()
      try {
        if (id) localStorage.setItem(selectedKey, id)
        else localStorage.removeItem(selectedKey)
      } catch {
        /* In-memory navigation remains available. */
      }
    },
    [hooksRef]
  )

  return {
    view,
    selected,
    settingsOpen: view === "settings",
    pluginsOpen: view === "plugins",
    settingsSection,
    setSettingsSection,
    registerSettingsLeave,
    openSettings,
    openGeneralSettings,
    openArchivedSettings,
    openUpdateSettings,
    openPlugins,
    leaveSettings,
    selectConversation,
  }
}
