import { useState } from "react"
import { AppShell } from "./app-shell"
import { HomeComposer } from "./home-composer"
import type { HomeData, SubmitWork } from "./home-types"

export function HomePage({
  data,
  onSubmit,
}: {
  data: HomeData
  onSubmit: SubmitWork
}) {
  const [draft, setDraft] = useState<{ key: number; workspaceId?: string }>({
    key: 0,
  })
  return (
    <AppShell
      data={data}
      onNew={(workspaceId) =>
        setDraft((v) => ({ key: v.key + 1, workspaceId }))
      }
      onSelectConversation={() => {}}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <HomeComposer
          key={draft.key}
          data={data}
          initialDraft={{ workspaceId: draft.workspaceId }}
          onSubmit={onSubmit}
        />
      </div>
    </AppShell>
  )
}
