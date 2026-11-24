import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { bridgeScript } from "../../apps/workbench/src/server/notes/preview.mjs"
import { PreviewInventory } from "../../apps/workbench/src/server/notes/preview-inventory.mjs"

// 执行实际生成的桥代码验证协议分支；浏览器导航/视觉另经正式入口验收。
function bridge({ loading = false, saved } = {}) {
  const messages = [],
    listeners = {},
    nodes = new Map(),
    navigations = []
  const parent = {
    postMessage: (message, origin) => messages.push({ ...message, origin }),
  }
  const storage = new Map(
    saved ? [["moon-preview-pending-focus", JSON.stringify(saved)]] : []
  )
  const document = {
    readyState: loading ? "loading" : "complete",
    documentElement: { appendChild() {} },
    addEventListener: (name, fn) => {
      listeners[name] = fn
    },
    querySelectorAll: () => [...nodes.values()],
    getElementsByTagName: (tag) =>
      [...nodes.values()].filter((node) => node.tagName.toLowerCase() === tag),
    getElementById: (id) => nodes.get(id),
    createElement: () => ({ style: {}, remove() {} }),
  }
  vm.runInNewContext(
    bridgeScript(["http://127.0.0.1:19830", "http://localhost:19830"]),
    {
      parent,
      document,
      URL,
      window: {
        addEventListener: (name, fn) => {
          listeners[name] = fn
        },
      },
      location: {
        href: "http://abcdef.localhost:19830/",
        origin: "http://abcdef.localhost:19830",
        pathname: "/",
        assign: (page) => navigations.push(page),
      },
      sessionStorage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      MutationObserver: class {
        observe() {}
      },
      setTimeout,
      clearTimeout,
    }
  )
  const send = (data, extra = {}) =>
    listeners.message({
      source: parent,
      origin: "http://127.0.0.1:19830",
      data,
      ...extra,
    })
  return { messages, listeners, nodes, navigations, send }
}

test("桥只消费父窗口消息，DOM就绪后处理最新请求并返回对应终态", () => {
  const b = bridge({ loading: true })
  const request = {
    type: "moon-preview-focus",
    requestId: "r1",
    target: { page: "/", id: "missing", tag: "button", text: "same" },
  }
  b.send({ type: "moon-preview-connect" })
  b.send(request, { source: {} })
  b.send(request, { origin: "http://evil" })
  assert.equal(b.messages.length, 0)
  b.send(request)
  b.send({ ...request, requestId: "r2" })
  assert.equal(b.messages.length, 0)
  b.listeners.DOMContentLoaded()
  assert.equal(b.messages[0].type, "moon-preview-focus-miss")
  assert.equal(b.messages[0].requestId, "r2")
  assert.equal(b.messages[1].type, "moon-preview-ready")
  assert.equal(b.messages[1].page, "/")
  b.send({ type: "moon-preview-connect" }, { origin: "http://evil" })
  assert.equal(b.messages.length, 2)
  b.send({ type: "moon-preview-connect" })
  assert.equal(b.messages[2].type, "moon-preview-ready")
  assert.equal(b.messages[2].page, "/")
})

test("指定ID缺失不能误指同文案元素；无ID歧义拒绝；采集每请求仅一回执", () => {
  const b = bridge()
  let focused = 0
  const node = {
    tagName: "BUTTON",
    id: "other",
    textContent: "same",
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    scrollIntoView: () => focused++,
  }
  b.nodes.set("other", node)
  b.send({
    type: "moon-preview-focus",
    requestId: "missing",
    target: { page: "/", id: "missing", tag: "button", text: "same" },
  })
  assert.equal(b.messages.at(-1).type, "moon-preview-focus-miss")
  assert.equal(focused, 0)
  b.send({
    type: "moon-preview-focus",
    requestId: "found",
    target: { page: "/", id: "other" },
  })
  assert.equal(b.messages.at(-1).type, "moon-preview-focus-ok")
  assert.equal(focused, 1)
  b.send({
    type: "moon-preview-focus",
    requestId: "found",
    target: { page: "/", id: "other" },
  })
  assert.equal(focused, 1)
  b.nodes.set("duplicate", { ...node, id: "duplicate" })
  b.send({
    type: "moon-preview-focus",
    requestId: "ambiguous",
    target: { page: "/", tag: "button", text: "same" },
  })
  assert.equal(b.messages.at(-1).type, "moon-preview-focus-miss")
  const count = b.messages.length
  b.send({ type: "moon-preview-collect" }, { origin: "http://localhost:19830" })
  assert.equal(b.messages.length, count + 1)
  assert.equal(b.messages.at(-1).origin, "http://localhost:19830")
})

test("跨页记录恢复缺失返回miss，外部导航拒绝", () => {
  const b = bridge({
    saved: {
      type: "moon-preview-focus",
      requestId: "saved",
      target: { page: "/", id: "gone" },
      parentOrigin: "http://localhost:19830",
    },
  })
  assert.equal(b.messages[0].requestId, "saved")
  assert.equal(b.messages[0].type, "moon-preview-focus-miss")
  b.send({
    type: "moon-preview-focus",
    requestId: "external",
    target: { page: "//evil/" },
  })
  assert.equal(b.messages.at(-1).reason, "page")
  assert.deepEqual(b.navigations, [])
})

test("清单必须属于manifest且结构有限，不伪造空成功或挤掉已有快照", () => {
  const inventory = new PreviewInventory(),
    manifest = { routes: { "/": "index.html" } }
  const element = {
    tag: "button",
    id: "a",
    text: "确定",
    rect: { x: 0, y: 0, width: 10, height: 20 },
  }
  assert.equal(inventory.capture("v1", manifest, "/", [element]), 1)
  for (const [page, elements] of [
    ["/other", []],
    ["/", null],
    ["/", [null]],
    ["/", [{ ...element, rect: { ...element.rect, width: Infinity } }]],
    ["/", Array(201).fill(element)],
  ])
    assert.throws(() => inventory.capture("v1", manifest, page, elements), {
      code: "validation_failed",
    })
  assert.equal(inventory.get("v1").pages["/"].elements.length, 1)
  for (let i = 2; i <= 128; i++) inventory.capture(`v${i}`, manifest, "/", [])
  assert.throws(() => inventory.capture("v129", manifest, "/", []), {
    code: "limit_exceeded",
  })
  assert.ok(inventory.get("v1"))
})
