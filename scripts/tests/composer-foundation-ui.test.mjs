import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"

let server,
  cache,
  ComposerAuxiliaryBar,
  ConversationSendControl,
  ConversationListFeedback,
  PromptInput,
  ComposerInputCard
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-composer-foundation-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ ComposerAuxiliaryBar } = await server.ssrLoadModule(
    "/src/features/conversation/composer/composer-auxiliary-bar.tsx"
  ))
  ;({ ConversationSendControl } = await server.ssrLoadModule(
    "/src/features/conversation/composer/conversation-send-control.tsx"
  ))
  ;({ ConversationListFeedback } = await server.ssrLoadModule(
    "/src/features/home/conversation-list-feedback.tsx"
  ))
  ;({ PromptInput } = await server.ssrLoadModule(
    "/src/features/home/prompt-input.tsx"
  ))
  ;({ ComposerInputCard } = await server.ssrLoadModule(
    "/src/components/composer/composer-input-card.tsx"
  ))
})
test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-composer-foundation-ui-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

// These rendered contracts protect reachable actions and truthful recovery.
// Keyboard behavior, layout, themes and actual Pi delivery need browser/native acceptance.
const onAction = () => assert.fail("rendering must never execute an action")
const render = (Component, props) =>
  renderToString(createElement(Component, props))
const buttonCount = (html) => (html.match(/<button\b/g) ?? []).length

test("delivery remains reachable without context statistics and does not move when the queue changes", () => {
  for (const queuedCount of [0, 10]) {
    const html = render(ComposerAuxiliaryBar, {
      queuedCount,
      deliveryMode: "single",
      onDeliveryModeChange: onAction,
    })
    assert.match(html, /aria-label="对话输入辅助设置"/)
    assert.equal(
      (html.match(/aria-label="消息交付设置，当前逐条交付"/g) ?? []).length,
      1
    )
    assert.equal(buttonCount(html), 1)
  }
})

test("unknown delivery shows one check action and an accessible lock explanation", () => {
  const html = render(ComposerAuxiliaryBar, {
    deliveryMode: "single",
    onDeliveryModeChange: onAction,
    modeIssue: {
      code: "result_unknown",
      message: "尚未确认原交付设置。",
      severity: "warning",
      recovery: "check",
    },
    onCheckMode: onAction,
  })
  assert.equal((html.match(/尚未确认原交付设置。/g) ?? []).length, 1)
  assert.match(html, /核对交付设置/)
  assert.match(html, /请先核对原操作/)
  assert.doesNotMatch(html, /重新读取交付设置|>重试</)
})

test("ordinary running input keeps a single primary Stop until the next draft is valid", () => {
  for (const props of [
    { hasDraft: false },
    { hasDraft: true, disabled: true },
    { hasDraft: true, command: "compact" },
  ]) {
    const html = render(ConversationSendControl, {
      running: true,
      ...props,
      onStop: onAction,
    })
    assert.equal(buttonCount(html), 1)
    assert.match(html, /aria-label="停止执行"/)
    assert.doesNotMatch(html, /排队发送/)
  }
  const ready = render(ConversationSendControl, {
    running: true,
    hasDraft: true,
    onStop: onAction,
  })
  assert.equal(buttonCount(ready), 2)
  assert.match(ready, /aria-label="排队发送"/)
  assert.match(ready, /aria-label="停止执行"/)
  const stopping = render(ConversationSendControl, {
    stopping: true,
    hasDraft: true,
    onStop: onAction,
  })
  assert.equal(buttonCount(stopping), 1)
  assert.match(stopping, /aria-label="正在停止"/)
  assert.match(stopping, /disabled=""/)
})

test("typed navigation feedback does not offer a fake reload for a host restart", () => {
  const html = render(ConversationListFeedback, {
    state: "error",
    hasItems: true,
    onRetry: onAction,
    issue: {
      code: "host_version",
      message: "Moon 服务版本已更新。",
      recovery: "restart",
      severity: "error",
    },
  })
  assert.match(html, /退出并重新启动 Moon/)
  assert.doesNotMatch(html, /重新读取会话列表/)
  assert.equal(buttonCount(html), 0)
})

test("home and conversation text inputs expose distinct density while sharing the actual input", () => {
  for (const variant of ["hero", "docked"]) {
    const html = renderToString(
      createElement(
        ComposerInputCard,
        null,
        createElement(PromptInput, {
          variant,
          value: "保留的输入",
          onChange: onAction,
          onSubmit: onAction,
        })
      )
    )
    assert.match(html, /保留的输入/)
    assert.match(html, new RegExp(`data-composer-variant="${variant}"`))
    assert.match(html, /moon-composer-prompt/)
  }
})
