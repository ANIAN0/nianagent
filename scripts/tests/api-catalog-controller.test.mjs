import assert from "node:assert/strict"
import test from "node:test"
import { createRequestController } from "../../api-catalog/request-controller.ts"
import { operations, validateRequest } from "../../backend/contract.mjs"

test("loading one operation at a time keeps earlier definitions and edited drafts usable", () => {
  const controller = createRequestController(() => {
    throw new Error("reading documentation must not invoke an operation")
  })
  controller.initialize({ list: operations.list })
  controller.setInput("list", '{"edited":true}')
  controller.initialize({ conversationList: operations.conversationList })
  controller.setInput("conversationList", '{"filter":{"query":"moon"}}')
  controller.initialize({ list: operations.list })
  assert.equal(controller.getSnapshot().list.input, '{"edited":true}')
  controller.restore("list")
  assert.equal(controller.getSnapshot().list.input, "{}")
  controller.restore("conversationList")
  assert.equal(
    controller.getSnapshot().conversationList.input,
    JSON.stringify(operations.conversationList.example, null, 2)
  )
  controller.dispose()
})

test("opening and editing an interface never invokes it; drafts and results are owned by operation", async () => {
  let calls = 0
  const controller = createRequestController(async () => {
    calls++
    return []
  })
  controller.initialize(operations)
  controller.setInput("conversationList", '{"filter":{"query":"moon"}}')
  controller.setInput("list", '{"unknown":true}')
  assert.equal(calls, 0)
  await controller.run("list", validateRequest)
  assert.equal(calls, 0)
  assert.equal(controller.getSnapshot().list.response.status, "error")
  assert.match(controller.getSnapshot().conversationList.input, /moon/)
  controller.restore("list")
  await controller.run("list", validateRequest)
  assert.equal(calls, 1)
  assert.equal(controller.getSnapshot().list.response.status, "success")
  assert.match(controller.getSnapshot().conversationList.input, /moon/)
  controller.dispose()
})

test("cancel and start another call: late old success cannot overwrite new response or its draft", async () => {
  const waits = []
  const controller = createRequestController(
    (operation, input, signal) =>
      new Promise((resolve) =>
        waits.push({ operation, input, signal, resolve })
      )
  )
  controller.initialize(operations)
  const old = controller.run("list", validateRequest)
  controller.cancel()
  assert.equal(waits[0].signal.aborted, true)
  const current = controller.run("list", validateRequest)
  waits[1].resolve(["current"])
  await current
  waits[0].resolve(["late"])
  await old
  assert.match(controller.getSnapshot().list.response.text, /current/)
  assert.doesNotMatch(controller.getSnapshot().list.response.text, /late/)
  controller.dispose()
})

test("busy guards keep call inputs stable; cancellation preserves the caller's draft", async () => {
  let release
  let calls = 0
  const controller = createRequestController(() => {
    calls++
    return new Promise((resolve) => {
      release = resolve
    })
  })
  controller.initialize(operations)
  controller.setInput("conversationList", '{"filter":{"query":"中文"}}')
  const active = controller.run("conversationList", validateRequest)
  controller.setInput("conversationList", "{}")
  controller.restore("conversationList")
  controller.clearResponse("conversationList")
  await controller.run("list", validateRequest)
  assert.equal(calls, 1)
  assert.match(controller.getSnapshot().conversationList.input, /中文/)
  assert.equal(
    controller.getSnapshot().conversationList.response.status,
    "running"
  )
  controller.cancel()
  assert.equal(
    controller.getSnapshot().conversationList.response.status,
    "cancelled"
  )
  assert.match(
    controller.getSnapshot().conversationList.response.text,
    /不会.*回滚/
  )
  release([])
  await active
  assert.equal(
    controller.getSnapshot().conversationList.response.status,
    "cancelled"
  )
  controller.dispose()
})

test("late old error after switching cannot replace the next operation success", async () => {
  let rejectOld
  const controller = createRequestController((operation) =>
    operation === "list"
      ? new Promise((_, reject) => {
          rejectOld = reject
        })
      : Promise.resolve(["new"])
  )
  controller.initialize(operations)
  const old = controller.run("list", validateRequest)
  controller.cancel()
  await controller.run("providers", validateRequest)
  rejectOld(new Error("old request failed"))
  await old
  assert.equal(controller.getSnapshot().list.response.status, "cancelled")
  assert.equal(controller.getSnapshot().providers.response.status, "success")
  controller.dispose()
})

test("revealKey masks the successful response, and clearing a response does not clear its input", async () => {
  const controller = createRequestController(async () => ({
    apiKey: "a-sensitive-test-value",
  }))
  controller.initialize(operations)
  controller.setInput("revealKey", '{"id":"connection", "revision":1}')
  await controller.run("revealKey", validateRequest)
  assert.doesNotMatch(
    controller.getSnapshot().revealKey.response.text,
    /a-sensitive-test-value/
  )
  controller.clearResponse("revealKey")
  assert.match(controller.getSnapshot().revealKey.input, /connection/)
  assert.equal(controller.getSnapshot().revealKey.response.status, "idle")
  controller.dispose()
})
