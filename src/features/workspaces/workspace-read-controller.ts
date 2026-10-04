import type { WorkspaceList } from "@/features/models/model-contract.generated"

type ReadEvents = {
  onPending: (pending: boolean) => void
  onSuccess: (result: WorkspaceList) => void
  onError: (error: unknown) => void
}

/** Completion confirms an accepted read, never just scheduling a refresh. */
export function createWorkspaceReadController(
  list: (signal: AbortSignal) => Promise<WorkspaceList>,
  events: ReadEvents
) {
  let sequence = 0
  let active: { sequence: number; controller: AbortController } | undefined

  function cancel() {
    const previous = active
    active = undefined
    sequence++
    previous?.controller.abort()
  }

  async function read(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const previous = active
    const controller = new AbortController()
    const request = ++sequence
    active = { sequence: request, controller }
    previous?.controller.abort()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    events.onPending(true)
    try {
      const result = await readUntilAborted(list, controller.signal)
      controller.signal.throwIfAborted()
      if (active?.sequence !== request || sequence !== request)
        throw new DOMException("工作目录读取已被后续操作替代。", "AbortError")
      events.onSuccess(result)
    } catch (error) {
      if (!controller.signal.aborted && active?.sequence === request)
        events.onError(error)
      throw error
    } finally {
      signal?.removeEventListener("abort", abort)
      if (active?.sequence === request) {
        active = undefined
        events.onPending(false)
      }
    }
  }

  return { read, cancel }
}

function readUntilAborted(
  list: (signal: AbortSignal) => Promise<WorkspaceList>,
  signal: AbortSignal
): Promise<WorkspaceList> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener("abort", aborted, { once: true })
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted()
        return list(signal)
      })
      .then(
        (result) => {
          signal.removeEventListener("abort", aborted)
          resolve(result)
        },
        (error) => {
          signal.removeEventListener("abort", aborted)
          reject(error)
        }
      )
  })
}
