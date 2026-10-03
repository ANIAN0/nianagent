import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"

let server, useConversationControls, cache
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-control-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ useConversationControls } = await server.ssrLoadModule(
    "/src/features/conversation/controls/use-conversation-controls.ts"
  ))
})
test.after(async () => {
  await server?.close()
  await rm(cache, { recursive: true, force: true })
})
function operation(
  id,
  status = "completed",
  updatedAt = "2026-10-03T09:20:04Z"
) {
  return {
    id,
    sessionId: "ui-session",
    kind: "compact",
    status,
    createdAt: "2026-10-03T09:20:00Z",
    updatedAt,
    error: "",
    focus: "",
  }
}
function fixture(t, initial, service) {
  const storage = new Map([
    ["moon.control.pending.ui-session", JSON.stringify(initial)],
  ])
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  let controls
  function Probe() {
    controls = useConversationControls(
      "ui-session",
      { control: { operation: initial } },
      service
    )
    return null
  }
  // Actual React mounts the official hook and its refs. These checks exercise
  // imperative request identity; DOM effects and visual acceptance are separate.
  renderToString(createElement(Probe))
  return {
    controls,
    stored: () => JSON.parse(storage.get("moon.control.pending.ui-session")),
  }
}
test("a late manual read for A cannot replace B's actual hook receipt or persisted identity", async (t) => {
  let releaseRead
  const f = fixture(t, operation("a"), {
    read: () =>
      new Promise((resolve) => {
        releaseRead = resolve
      }),
    compact: async (sessionId, id) => ({
      ...operation(id, "running", new Date().toISOString()),
      sessionId,
    }),
  })
  const oldRead = f.controls.read()
  const b = await f.controls.compact("new focus")
  assert.equal(f.stored().id, b.id)
  releaseRead(operation("a"))
  assert.equal(await oldRead, undefined)
  assert.equal(f.stored().id, b.id)
  assert.equal(f.stored().status, "running")
})
test("an earlier running receipt cannot regress the same completed operation", async (t) => {
  const f = fixture(t, operation("a"), {
    read: async () => operation("a", "running", "2026-10-03T09:20:01Z"),
  })
  const result = await f.controls.read()
  assert.equal(result.status, "completed")
  assert.equal(f.stored().status, "completed")
})
test("the official operation identity binds the command before its request can complete", async (t) => {
  let boundId
  let boundBeforeRequest = false
  const f = fixture(t, operation("a"), {
    compact: async (sessionId, id) => {
      boundBeforeRequest = boundId === id
      assert.equal(f.stored().id, id)
      return {
        ...operation(id, "completed", new Date().toISOString()),
        sessionId,
      }
    },
  })
  const result = await f.controls.compact("B focus", (id) => {
    boundId = id
  })
  assert.equal(boundBeforeRequest, true)
  assert.equal(result.id, boundId)
  assert.notEqual(boundId, "a")
})
