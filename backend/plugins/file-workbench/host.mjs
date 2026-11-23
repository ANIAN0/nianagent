import { Documents } from "./documents.mjs"
import { gitStatus, gitDiff } from "./git.mjs"
import { fileOperations } from "./contract.mjs"
export async function activate(host) {
  const documents = new Documents(host)
  const views = new Map()
  const events = new Map()
  const operation = (name, execute) => ({
    ...fileOperations[name],
    execute: async (...args) => ({ value: await execute(...args) }),
  })
  return {
    documents,
    operations: {
      git: operation("git", gitStatus),
      gitDiff: operation("gitDiff", gitDiff),
      tree: operation("tree", documents.tree.bind(documents)),
      info: operation("info", documents.info.bind(documents)),
      text: operation("text", documents.text.bind(documents)),
      bytes: operation("bytes", documents.bytes.bind(documents)),
      state: operation("state", documents.state.bind(documents)),
      reference: operation("reference", documents.reference.bind(documents)),
      selection: operation("selection", async (input, context, signal) => ({
        material: await host.materials.selection(context, input, signal),
      })),
      view: operation("view", async (input, context) => {
        const previous = views.get(context.clientId)
        if (!input.active) {
          if (
            previous?.token === input.token &&
            previous.sessionId === context.sessionId &&
            previous.generation === input.generation
          ) {
            previous.until = 0
            events.delete(context.clientId)
          }
          return { requests: [] }
        }
        if (
          previous &&
          (input.generation < previous.generation ||
            (input.generation === previous.generation &&
              (input.token !== previous.token || previous.until === 0)))
        )
          return { requests: [] }
        if (
          previous?.sessionId !== context.sessionId ||
          previous.token !== input.token
        )
          events.delete(context.clientId)
        views.set(context.clientId, {
          sessionId: context.sessionId,
          token: input.token,
          generation: input.generation,
          until: Date.now() + 15000,
        })
        const requests = (events.get(context.clientId) || []).filter(
          (item) => item.until > Date.now()
        )
        events.delete(context.clientId)
        return { requests }
      }),
    },
    captureTarget(context, sessionId) {
      const view = views.get(context.clientId)
      return view && view.sessionId === sessionId && view.until > Date.now()
        ? { token: view.token, generation: view.generation }
        : null
    },
    async requestOpen(input, context, signal) {
      const target = await documents.info(input, context, signal)
      signal?.throwIfAborted()
      const view = views.get(context.clientId)
      const origin = context.targets?.["file-workbench"]
      const requested =
        context.foreground !== false &&
        view?.sessionId === context.sessionId &&
        view.until > Date.now() &&
        origin?.token === view.token &&
        origin.generation === view.generation
      if (requested) {
        const queue = events.get(context.clientId) || []
        queue.push({
          path: target.requested,
          until: Date.now() + 5000,
          token: view.token,
        })
        events.set(context.clientId, queue.slice(-8))
        host.emit?.("open-requested", { sessionId: context.sessionId })
      }
      return {
        path: target.path,
        requestedPath: target.requested,
        name: target.name,
        requested,
      }
    },
    presentation(result) {
      const value = result?.details?.moonFileLink
      if (
        value &&
        typeof value.path === "string" &&
        typeof value.name === "string"
      )
        return { kind: "file-link", version: 1, payload: JSON.stringify(value) }
    },
    status: () => "可用",
    close() {
      views.clear()
      events.clear()
    },
  }
}
