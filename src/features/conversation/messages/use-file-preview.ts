import { useEffect, useRef, useState } from "react"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { useMessageEnvironment } from "./message-environment"

export function useFilePreview(path: string) {
  const environment = useMessageEnvironment()
  const owner = JSON.stringify([environment?.sessionId, environment?.cwd, path])
  const [state, setState] = useState<{
    owner: string
    pending: boolean
    issue?: FeedbackDescription
  }>({ owner, pending: false })
  if (state.owner !== owner) {
    // Adjust state with the render owner, rather than resetting it in an
    // effect. Returning A → B → A must not revive A's invalidated request.
    setState({ owner, pending: false })
  }
  const request = useRef<{ owner: string } | undefined>(undefined)
  useEffect(
    () => () => {
      // Ownership changes hide old state immediately through the owner key.
      // Cleanup only invalidates the asynchronous request; it does not create
      // a second render to reset another file's pending/error presentation.
      if (request.current?.owner === owner) request.current = undefined
    },
    [owner]
  )
  async function open() {
    if (!environment?.onOpenPath || request.current?.owner === owner) return
    const operation = { owner }
    request.current = operation
    setState({ owner, pending: true })
    try {
      await environment.onOpenPath(path)
    } catch (error) {
      if (
        request.current === operation &&
        !(error instanceof Error && error.name === "AbortError")
      )
        setState({ owner, pending: false, issue: feedbackFromError(error) })
    } finally {
      if (request.current === operation) {
        request.current = undefined
        setState((previous) =>
          previous?.owner === owner ? { ...previous, pending: false } : previous
        )
      }
    }
  }
  const visibleState = state.owner === owner ? state : undefined
  return {
    pending: visibleState?.pending ?? false,
    issue: visibleState?.issue,
    open,
    available: Boolean(environment?.onOpenPath),
    onSettings: environment?.onOpenSettings,
  }
}
