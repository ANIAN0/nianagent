import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement } from "react"
import { Terminal } from "lucide-react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"

let server,
  cache,
  RecoveryAction,
  WorkspacePicker,
  MaterialCandidateList,
  createWorkspaceReadController
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-home-recovery-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ RecoveryAction } = await server.ssrLoadModule(
    "/src/components/feedback/recovery-action.tsx"
  ))
  ;({ WorkspacePicker } = await server.ssrLoadModule(
    "/src/features/home/workspace-picker.tsx"
  ))
  ;({ MaterialCandidateList } = await server.ssrLoadModule(
    "/src/features/materials/material-candidate-list.tsx"
  ))
  ;({ createWorkspaceReadController } = await server.ssrLoadModule(
    "/src/features/workspaces/workspace-read-controller.ts"
  ))
})
test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-home-recovery-ui-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

// SSR checks the rendered action contract. Layout, focus and reactive recovery
// still require the actual homepage/browser acceptance.
const callbacks = {
  onRetry() {
    throw new Error("rendering must not retry")
  },
  onReload() {
    throw new Error("rendering must not reload")
  },
  onCheck() {
    throw new Error("rendering must not check")
  },
  onSettings() {
    throw new Error("rendering must not navigate")
  },
}
function issue(recovery) {
  return {
    code: "host_version",
    message: "Moon 服务已更新。",
    recovery,
    severity: "error",
  }
}
test("restart recovery cannot render a retry even when all handlers exist", () => {
  const html = renderToString(
    createElement(RecoveryAction, { issue: issue("restart"), ...callbacks })
  )
  assert.match(html, /退出并重新启动 Moon/)
  assert.doesNotMatch(html, /<button/)
})
test("unknown recovery only renders its check action, and none exposes no action", () => {
  const html = renderToString(
    createElement(RecoveryAction, { issue: issue("check"), ...callbacks })
  )
  assert.equal((html.match(/<button\b/g) ?? []).length, 1)
  assert.match(html, /核对状态/)
  assert.doesNotMatch(html, />重试<|>重新读取<|>打开设置</)
  assert.equal(
    renderToString(
      createElement(RecoveryAction, { issue: issue("none"), ...callbacks })
    ),
    ""
  )
})
test("workspace restart guidance retains the selected directory without an ineffective reload", () => {
  const html = renderToString(
    createElement(WorkspacePicker, {
      workspaces: [
        { id: "current", name: "当前工作区", path: "H:/workspace/moon" },
      ],
      value: "current",
      onChange() {},
      onRetry: callbacks.onReload,
      issue: issue("restart"),
    })
  )
  assert.match(html, /当前工作区/)
  assert.match(html, /退出并重新启动 Moon/)
  assert.doesNotMatch(html, />重试<|>重新读取目录<|data-slot="alert"/)
})
test("cancelled workspace read remains informational and reloads only when its contract allows it", () => {
  const html = renderToString(
    createElement(WorkspacePicker, {
      workspaces: [],
      value: "",
      onChange() {},
      onRetry: callbacks.onReload,
      issue: {
        code: "cancelled",
        message: "工作目录读取已取消。",
        severity: "info",
        recovery: "reload",
      },
    })
  )
  assert.match(html, /role="status"/)
  assert.match(html, /重新读取目录/)
  assert.doesNotMatch(html, /role="alert"|text-destructive/)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function readFixture(list) {
  const events = { pending: [], accepted: [], errors: [] }
  const reader = createWorkspaceReadController(list, {
    onPending: (value) => events.pending.push(value),
    onSuccess: (value) => events.accepted.push(value),
    onError: (error) => events.errors.push(error),
  })
  return { reader, events }
}
const confirmedDirectory = {
  items: [
    { id: "confirmed", name: "已确认目录", path: "H:/workspace/confirmed" },
  ],
  selectedId: "confirmed",
}
test("directory refresh resolves only after the actual result is accepted", async () => {
  const waiting = deferred()
  const f = readFixture(() => waiting.promise)
  let confirmed = false
  const completion = f.reader.read().then(() => {
    confirmed = true
    assert.deepEqual(f.events.accepted, [confirmedDirectory])
  })
  await Promise.resolve()
  assert.equal(confirmed, false)
  assert.deepEqual(f.events.pending, [true])
  assert.deepEqual(f.events.accepted, [])
  waiting.resolve(confirmedDirectory)
  await completion
  assert.equal(confirmed, true)
  assert.deepEqual(f.events.pending, [true, false])
})
test("a failed directory recheck rejects with its original typed cause and does not adopt an unconfirmed selection", async () => {
  const failure = Object.assign(new Error("目录读取失败。"), {
    issue: {
      code: "workspace_read",
      summary: "目录读取失败。",
      severity: "error",
      recovery: "retry",
    },
  })
  const f = readFixture(async () => {
    throw failure
  })
  await assert.rejects(f.reader.read(), (error) => error === failure)
  assert.deepEqual(f.events.errors, [failure])
  assert.deepEqual(f.events.accepted, [])
  assert.deepEqual(f.events.pending, [true, false])
})
test("a superseded directory request rejects promptly and its late result cannot replace the new selection", async () => {
  const waits = []
  const f = readFixture((signal) => {
    const waiting = deferred()
    waits.push({ ...waiting, signal })
    return waiting.promise // Deliberately ignore abort to exercise late transport results.
  })
  const oldRead = f.reader.read()
  const cancelled = assert.rejects(oldRead, { name: "AbortError" })
  await Promise.resolve()
  const newRead = f.reader.read()
  await Promise.resolve()
  assert.equal(waits[0].signal.aborted, true)
  await cancelled
  assert.deepEqual(f.events.pending, [true, true])
  waits[0].resolve({ items: [], selectedId: null })
  waits[1].resolve(confirmedDirectory)
  await newRead
  assert.deepEqual(f.events.accepted, [confirmedDirectory])
  assert.deepEqual(f.events.errors, [])
  assert.deepEqual(f.events.pending, [true, true, false])
})
test("caller cancellation ends recovery without accepting a transport that ignores abort", async () => {
  const waiting = deferred()
  const f = readFixture(() => waiting.promise)
  const controller = new AbortController()
  const cancelled = assert.rejects(f.reader.read(controller.signal), {
    name: "AbortError",
  })
  await Promise.resolve()
  controller.abort()
  await cancelled
  assert.deepEqual(f.events.pending, [true, false])
  waiting.resolve(confirmedDirectory)
  await Promise.resolve()
  assert.deepEqual(f.events.accepted, [])
  assert.deepEqual(f.events.errors, [])
})
test("adopting a workspace or leaving the page invalidates a pending read before its late response", async () => {
  const waiting = deferred()
  const f = readFixture(() => waiting.promise)
  const cancelled = assert.rejects(f.reader.read(), { name: "AbortError" })
  await Promise.resolve()
  f.reader.cancel()
  await cancelled
  const before = structuredClone(f.events)
  waiting.resolve(confirmedDirectory)
  await Promise.resolve()
  assert.deepEqual(f.events, before)
  assert.deepEqual(f.events.accepted, [])
})
test("an already aborted recovery cannot begin another directory read", async () => {
  let calls = 0
  const f = readFixture(async () => {
    calls++
    return confirmedDirectory
  })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(f.reader.read(controller.signal), { name: "AbortError" })
  assert.equal(calls, 0)
  assert.deepEqual(f.events.pending, [])
})

test("resource host restart stays a warning without a reload and keeps independent commands", () => {
  const html = renderToString(
    createElement(MaterialCandidateList, {
      id: "typed-resources",
      rows: [
        {
          id: "compact",
          group: "内置命令",
          name: "压缩上下文",
          description: "填入命令",
          icon: Terminal,
        },
      ],
      active: 0,
      listRef: { current: null },
      maxHeight: 320,
      statusGroup: "Skill 调用",
      issue: { ...issue("restart"), severity: "warning" },
      onRetry: callbacks.onReload,
      onActive() {},
      onSelect() {},
    })
  )
  assert.match(html, /退出并重新启动 Moon/)
  assert.match(html, /压缩上下文/)
  assert.match(html, /role="status"/)
  assert.doesNotMatch(html, />重新读取<|>重试<|role="alert"/)
})
