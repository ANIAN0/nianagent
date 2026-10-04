import { createContext, useContext, useState, type ReactNode } from "react"
import type { MessageAttachment } from "../conversation-types"

export type MessageEnvironment = {
  sessionId: string
  cwd: string
  disclosures: Map<string, boolean>
  onOpenPath?: (path: string) => Promise<void>
  onOpenAttachment?: (attachment: MessageAttachment) => void
  onOpenSettings?: () => void
}
const Context = createContext<MessageEnvironment | null>(null)

/** State belongs to a session and a real block occurrence, never a provider tool id. */
export function MessageEnvironmentProvider({
  value,
  children,
}: {
  value: MessageEnvironment
  children: ReactNode
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useMessageEnvironment() {
  return useContext(Context)
}
export function useMessageDisclosure(
  occurrence: string | undefined,
  kind: string,
  defaultOpen = false
) {
  const environment = useMessageEnvironment()
  const key = occurrence ? `${occurrence}:${kind}` : undefined
  const [open, setOpen] = useState(() =>
    key ? (environment?.disclosures.get(key) ?? defaultOpen) : defaultOpen
  )
  function update(next: boolean) {
    if (key) environment?.disclosures.set(key, next)
    setOpen(next)
  }
  return [open, update] as const
}
