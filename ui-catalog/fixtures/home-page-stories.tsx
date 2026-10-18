import { useState } from "react"
import { AppShell } from "@/features/home/app-shell"
import { SettingsExample } from "@/features/settings/settings.catalog"
import { SettingsExample as PluginSettingsExample } from "@/features/plugins/plugin-settings.catalog"
import { HomeStoryExample, type HomeScenario } from "./home-stories"
import { ConversationPageExample } from "./conversation-page-stories"
import { Button } from "@/components/ui/button"

/** Reuses the input story's Providers, data and interactions inside the formal workspace shell. */
export function HomePageExample({
  scenario = "normal",
}: {
  scenario?: HomeScenario
}) {
  const [view, setView] = useState("home")
  const [revision, setRevision] = useState(0)
  return (
    <HomeStoryExample
      key={revision}
      scenario={scenario}
      frame={(content, data) => (
        <AppShell
          data={data}
          activeConversationId={
            view === "conversation" ? data.conversations[0]?.id : undefined
          }
          onNew={() => {
            setView("home")
            setRevision((value) => value + 1)
          }}
          onSelectConversation={() => setView("conversation")}
          onSettings={() => setView("settings")}
          onPlugins={() => setView("plugins")}
          historyState="ready"
        >
          {view === "home" ? (
            content
          ) : view === "conversation" ? (
            <ConversationPageExample scenario="page-ready" />
          ) : view === "settings" ? (
            <SettingsExample
              scenario="storage"
              onReturn={() => setView("home")}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView("home")}
                >
                  返回首页
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <PluginSettingsExample />
              </div>
            </div>
          )}
        </AppShell>
      )}
    />
  )
}
