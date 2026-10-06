import { useEffect, useRef } from "react"
import { notifyComposer } from "@/components/composer/composer-notification"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"

/** SDK notifications are transient. Loading history establishes a baseline. */
export function useConversationNotifications(
  id: string,
  snapshot?: ConversationSnapshot
) {
  const previous = useRef<{ id: string; notices: Set<string> } | undefined>(
    undefined
  )
  const notices = snapshot?.extensionNotifications
  const ready = !!snapshot
  useEffect(() => {
    if (!ready) return
    const baseline = previous.current
    if (baseline?.id === id) {
      for (const notice of notices ?? []) {
        if (!baseline.notices.has(notice.id))
          notifyComposer(notice.message, {
            id: `sdk-notice:${id}:${notice.id}`,
          })
      }
    }
    previous.current = {
      id,
      notices: new Set((notices ?? []).map((notice) => notice.id)),
    }
  }, [id, notices, ready])
}
