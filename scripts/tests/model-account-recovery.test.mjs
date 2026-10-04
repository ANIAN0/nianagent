import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join, relative, isAbsolute } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"

let server, cache, useConnectionEditor, mergeAccountSnapshot
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-account-recovery-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ useConnectionEditor, mergeAccountSnapshot } = await server.ssrLoadModule(
    "/src/features/models/use-connection-editor.ts"
  ))
})
test.after(async () => {
  await server?.close()
  if (!cache) return
  const boundary = relative(resolve(tmpdir()), resolve(cache))
  assert.ok(boundary && !boundary.startsWith("..") && !isAbsolute(boundary))
  assert.ok(boundary.startsWith("moon-account-recovery-"))
  await rm(cache, { recursive: true, force: true })
})

function connection() {
  return {
    id: "account-connection",
    name: "Subscription",
    kind: "subscription",
    providerId: "example",
    endpoint: "",
    credential: "none",
    keySaved: false,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [
      {
        id: "saved-model",
        name: "Saved model",
        api: "openai-responses",
        input: ["text"],
      },
    ],
    revision: 4,
    accountOperationBusy: false,
    account: { name: "demo@example.invalid", plan: "Example", loggedIn: true },
  }
}
function issue(code, recovery = "check") {
  return {
    issue: {
      code,
      recovery,
      severity: recovery === "check" ? "warning" : "error",
      summary: "示例服务请求没有返回明确结果。",
    },
  }
}
function mount(service, initial = connection(), onAccountSaved = () => {}) {
  let editor
  function Probe() {
    editor = useConnectionEditor({
      initial,
      connections: [connection()],
      service,
      onSaved() {
        assert.fail("Account recovery must not save a connection")
      },
      onAccountSaved,
      onClose() {},
    })
    return null
  }
  // Mount the official controller; request refs enforce the same boundary even
  // before React's next render. Browser effects and visual states are separate.
  renderToString(createElement(Probe))
  return editor
}
const settled = () => new Promise(setImmediate)

test("an unknown logout blocks a second logout, new authorization and connection save", async () => {
  let rejectLogout
  let logouts = 0
  let reads = 0
  let saves = 0
  const service = {
    auth: {
      logout() {
        logouts++
        return new Promise((_, reject) => {
          rejectLogout = reject
        })
      },
    },
    async list() {
      reads++
      return [connection()]
    },
    async save() {
      saves++
      return connection()
    },
  }
  const editor = mount(service)
  editor.updateAccount({ ...connection().account, loggedIn: false })
  editor.readAccountState()
  assert.equal(reads, 0, "A read cannot race a pending logout")
  rejectLogout(issue("result_unknown"))
  await settled()
  editor.updateAccount({ ...connection().account, loggedIn: false })
  editor.save()
  assert.equal(editor.startAuthorization(), false)
  await settled()
  assert.equal(logouts, 1)
  assert.equal(saves, 0)
  const reopened = mount(service)
  assert.equal(reopened.accountUnknown, true)
  assert.equal(reopened.accountFailure.code, "result_unknown")
  assert.equal(reopened.startAuthorization(), false)
})

test("current login-state recovery performs only a list read and publishes the authoritative account", async () => {
  let logouts = 0
  let reads = 0
  let published
  const saved = {
    ...connection(),
    account: { ...connection().account, loggedIn: false },
  }
  const service = {
    auth: {
      async logout() {
        logouts++
        throw issue("result_unknown")
      },
    },
    async list() {
      reads++
      return [saved]
    },
    save() {
      assert.fail("A current account read may never replay a write")
    },
  }
  const editor = mount(service, connection(), (value) => {
    published = value
  })
  editor.updateAccount({ ...connection().account, loggedIn: false })
  await settled()
  editor.readAccountState()
  await settled()
  assert.equal(logouts, 1)
  assert.equal(reads, 1)
  assert.deepEqual(published, saved)
  assert.equal(editor.startAuthorization(), true)
})

test("failed current-state reads retain the gate until a later read succeeds", async () => {
  let readFailure = true
  let logouts = 0
  const service = {
    auth: {
      async logout() {
        logouts++
        throw issue("result_unknown")
      },
    },
    async list() {
      if (readFailure) throw issue("storage_access", "reload")
      return [connection()]
    },
  }
  const editor = mount(service)
  editor.updateAccount({ ...connection().account, loggedIn: false })
  await settled()
  editor.readAccountState()
  await settled()
  assert.equal(editor.startAuthorization(), false)
  editor.updateAccount({ ...connection().account, loggedIn: false })
  assert.equal(logouts, 1)
  const reopened = mount(service)
  assert.equal(reopened.accountUnknown, true)
  assert.equal(reopened.accountFailure.code, "storage_access")
  readFailure = false
  reopened.readAccountState()
  await settled()
  assert.equal(reopened.startAuthorization(), true)
})

test("an account snapshot preserves every unrelated draft field and its models", () => {
  const draft = {
    ...connection(),
    name: "Unsaved name",
    endpoint: "https://example.invalid/unsaved",
    headers: '{"X-Example":"unsaved"}',
    models: [
      {
        id: "unsaved-model",
        name: "Unsaved model",
        api: "openai-completions",
        input: ["text"],
      },
    ],
  }
  const saved = {
    ...connection(),
    account: { ...connection().account, loggedIn: false },
  }
  const merged = mergeAccountSnapshot(draft, saved)
  assert.equal(merged.account, saved.account)
  assert.equal(merged.models, draft.models)
  assert.equal(merged.name, draft.name)
  assert.equal(merged.endpoint, draft.endpoint)
  assert.equal(merged.headers, draft.headers)
  assert.equal(merged.revision, saved.revision)
  assert.equal(draft.account.loggedIn, true)
})

test("a newer connection revision is not adopted as the draft CAS during account recovery", async () => {
  let logouts = 0
  let saves = 0
  let published
  const service = {
    auth: {
      async logout() {
        logouts++
        throw issue("result_unknown")
      },
    },
    async list() {
      return [
        {
          ...connection(),
          revision: 5,
          name: "Changed elsewhere",
          account: { ...connection().account, loggedIn: false },
        },
      ]
    },
    async save() {
      saves++
      return connection()
    },
  }
  const editor = mount(service, connection(), (value) => {
    published = value
  })
  editor.updateAccount({ ...connection().account, loggedIn: false })
  await settled()
  editor.readAccountState()
  await settled()
  assert.equal(
    published.revision,
    5,
    "The directory receives the actual current version"
  )
  assert.equal(editor.startAuthorization(), false)
  editor.updateAccount({ ...connection().account, loggedIn: false })
  editor.save()
  assert.equal(logouts, 1)
  assert.equal(
    saves,
    0,
    "The editor cannot submit its old draft with a newer CAS"
  )
})

test("an already logged-out account remains gated while the provider operation is still busy", async () => {
  let busy = true
  let logouts = 0
  let reads = 0
  let published = 0
  const service = {
    auth: {
      async logout() {
        logouts++
        throw issue("result_unknown")
      },
    },
    async list() {
      reads++
      return [
        {
          ...connection(),
          accountOperationBusy: busy,
          account: { ...connection().account, loggedIn: false },
        },
      ]
    },
    save() {
      assert.fail("An account still clearing must not permit a write")
    },
  }
  const editor = mount(service, connection(), () => published++)
  editor.updateAccount({ ...connection().account, loggedIn: false })
  await settled()
  editor.readAccountState()
  await settled()
  assert.equal(editor.startAuthorization(), false)
  editor.updateAccount({ ...connection().account, loggedIn: false })
  editor.save()
  assert.equal(logouts, 1)
  assert.equal(
    published,
    0,
    "Logged-out values alone must not release the account owner"
  )
  const reopened = mount(service)
  assert.equal(reopened.accountUnknown, true)
  assert.equal(reopened.accountFailure.code, "account_operation_pending")
  busy = false
  reopened.readAccountState()
  await settled()
  assert.equal(reads, 2)
  assert.equal(reopened.startAuthorization(), true)
  assert.equal(published, 0)
})

test("an older host without account-operation evidence requires restart and keeps the write gate", async () => {
  let logouts = 0
  let reads = 0
  const service = {
    auth: {
      async logout() {
        logouts++
        throw issue("result_unknown")
      },
    },
    async list() {
      reads++
      const saved = {
        ...connection(),
        account: { ...connection().account, loggedIn: false },
      }
      delete saved.accountOperationBusy
      return [saved]
    },
    save() {
      assert.fail("An unsupported host must not permit a write")
    },
  }
  const editor = mount(service)
  editor.updateAccount({ ...connection().account, loggedIn: false })
  await settled()
  editor.readAccountState()
  await settled()
  const reopened = mount(service)
  assert.equal(reopened.accountUnknown, true)
  assert.equal(reopened.accountFailure.code, "host_version")
  assert.equal(reopened.accountFailure.recovery, "restart")
  assert.equal(reopened.startAuthorization(), false)
  reopened.updateAccount({ ...connection().account, loggedIn: false })
  reopened.save()
  assert.equal(
    reads,
    1,
    "There is no automatic polling or retry loop for unsupported evidence"
  )
  assert.equal(logouts, 1)
})
