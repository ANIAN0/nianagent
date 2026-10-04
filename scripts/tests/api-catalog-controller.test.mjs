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
    /已取消等待/
  )
  assert.match(
    controller.getSnapshot().conversationList.response.text,
    /不保证回滚/
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

const originalQueueInputs = {
  conversationQueueRemove: {
    sessionId: "queue-session",
    itemId: "queue-item",
    revision: 7,
  },
  conversationQueueMode: {
    sessionId: "queue-session",
    mode: "all",
    revision: 7,
  },
  conversationQueueDeliver: {
    sessionId: "queue-session",
    itemId: "queue-item",
    revision: 7,
  },
}

function unknownQueueError() {
  return Object.assign(new Error("原响应丢失。"), {
    name: "RpcTransportError",
    issue: {
      code: "result_unknown",
      summary: "原响应丢失。",
      recovery: "check",
      severity: "warning",
    },
  })
}

for (const [operation, originalInput] of Object.entries(originalQueueInputs)) {
  test(`${operation} freezes its original identity after lost response and cannot repeat or erase it`, async () => {
    const calls = []
    const controller = createRequestController(
      async (calledOperation, input) => {
        calls.push({ operation: calledOperation, input })
        throw unknownQueueError()
      }
    )
    controller.initialize(operations)
    controller.setInput(operation, JSON.stringify(originalInput))
    await controller.run(operation, validateRequest)
    const response = controller.getSnapshot()[operation].response
    assert.equal(response.status, "unknown")
    assert.equal(typeof calls[0].input.operationRequestId, "string")
    assert.equal(calls[0].input.operationRequestId.length > 0, true)
    assert.deepEqual(response.queueReceiptInput, {
      sessionId: originalInput.sessionId,
      operationRequestId: calls[0].input.operationRequestId,
    })
    assert.equal(Object.isFrozen(response.queueReceiptInput), true)
    validateRequest("conversationQueueReceiptRead", response.queueReceiptInput)
    controller.setInput(
      operation,
      JSON.stringify({ ...originalInput, operationRequestId: "a-new-id" })
    )
    controller.clearResponse(operation)
    await controller.run(operation, validateRequest)
    assert.equal(calls.length, 1)
    assert.deepEqual(
      controller.getSnapshot()[operation].response.queueReceiptInput,
      response.queueReceiptInput
    )
    controller.dispose()
  })
}

test("cancelled queue mutation keeps original query parameters and a late success cannot settle them", async () => {
  let release
  const calls = []
  const controller = createRequestController((operation, input, signal) => {
    calls.push({ operation, input, signal })
    return new Promise((resolve) => {
      release = resolve
    })
  })
  controller.initialize(operations)
  controller.setInput(
    "conversationQueueRemove",
    JSON.stringify({
      ...originalQueueInputs.conversationQueueRemove,
      operationRequestId: "original-remove",
    })
  )
  const pending = controller.run("conversationQueueRemove", validateRequest)
  controller.cancel()
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(
    controller.getSnapshot().conversationQueueRemove.response.status,
    "unknown"
  )
  assert.deepEqual(
    controller.getSnapshot().conversationQueueRemove.response.queueReceiptInput,
    {
      sessionId: "queue-session",
      operationRequestId: "original-remove",
    }
  )
  release({ sessionId: "queue-session", queue: { revision: 8, items: [] } })
  await pending
  await controller.run("conversationQueueRemove", validateRequest)
  assert.equal(calls.length, 1)
  assert.equal(
    controller.getSnapshot().conversationQueueRemove.response.status,
    "unknown"
  )
  controller.dispose()
})

test("missing, mismatched or preparing queue receipts never release the original request", async () => {
  const original = {
    sessionId: "queue-session",
    operationRequestId: "original-remove",
  }
  let queriedReceipt
  const calls = []
  const controller = createRequestController(async (operation, input) => {
    calls.push({ operation, input })
    if (operation === "conversationQueueRemove") throw unknownQueueError()
    return queriedReceipt
  })
  controller.initialize(operations)
  controller.setInput(
    "conversationQueueRemove",
    JSON.stringify({
      ...originalQueueInputs.conversationQueueRemove,
      ...original,
    })
  )
  await controller.run("conversationQueueRemove", validateRequest)
  controller.setInput("conversationQueueReceiptRead", JSON.stringify(original))
  for (const receipt of [
    { ...original, state: "unknown", retryOriginalAllowed: true },
    {
      ...original,
      state: "unknown",
      operation: "conversationQueueRemove",
      baseRevision: 7,
      itemId: "queue-item",
    },
    {
      ...original,
      state: "committed",
      operation: "conversationQueueRemove",
      sessionId: "other-session",
    },
    {
      ...original,
      state: "committed",
      operation: "conversationQueueRemove",
      operationRequestId: "other-id",
    },
    { ...original, state: "committed", operation: "conversationQueueMode" },
    { ...original, state: "committed" },
  ]) {
    queriedReceipt = receipt
    await controller.run("conversationQueueReceiptRead", validateRequest)
    assert.equal(
      controller.getSnapshot().conversationQueueRemove.response.status,
      "unknown"
    )
    assert.deepEqual(
      controller.getSnapshot().conversationQueueRemove.response
        .queueReceiptInput,
      original
    )
    await controller.run("conversationQueueRemove", validateRequest)
    assert.equal(
      calls.filter((call) => call.operation === "conversationQueueRemove")
        .length,
      1
    )
  }
  assert.equal(
    calls.filter((call) => call.operation === "conversationQueueReceiptRead")
      .length,
    6
  )
  controller.dispose()
})

for (const state of ["committed", "rejected"]) {
  test(`a matching ${state} queue receipt settles by the original SID and ID without executing again`, async () => {
    const original = {
      sessionId: "queue-session",
      operationRequestId: "original-deliver",
    }
    const calls = []
    const issue = {
      code: "revision_conflict",
      summary: "队列已更新。",
      recovery: "reload",
      severity: "warning",
    }
    const controller = createRequestController(async (operation, input) => {
      calls.push({ operation, input })
      if (operation === "conversationQueueDeliver") throw unknownQueueError()
      return {
        ...original,
        state,
        operation: "conversationQueueDeliver",
        baseRevision: 7,
        itemId: "queue-item",
        ...(state === "committed" ? { revision: 8 } : { issue }),
      }
    })
    controller.initialize(operations)
    controller.setInput(
      "conversationQueueDeliver",
      JSON.stringify({
        ...originalQueueInputs.conversationQueueDeliver,
        ...original,
      })
    )
    await controller.run("conversationQueueDeliver", validateRequest)
    // A later editable draft must not change which original receipt is queried.
    controller.setInput(
      "conversationQueueDeliver",
      JSON.stringify({
        ...originalQueueInputs.conversationQueueDeliver,
        operationRequestId: "next-draft",
      })
    )
    controller.setInput(
      "conversationQueueReceiptRead",
      JSON.stringify(original)
    )
    await controller.run("conversationQueueReceiptRead", validateRequest)
    const settled = controller.getSnapshot().conversationQueueDeliver.response
    assert.equal(settled.status, state === "committed" ? "success" : "error")
    assert.equal(settled.queueReceiptInput, undefined)
    assert.equal(
      calls.filter((call) => call.operation === "conversationQueueDeliver")
        .length,
      1
    )
    assert.equal(
      JSON.parse(controller.getSnapshot().conversationQueueDeliver.input)
        .operationRequestId,
      "next-draft"
    )
    if (state === "rejected") assert.equal(settled.issue.code, issue.code)
    controller.clearResponse("conversationQueueDeliver")
    assert.equal(
      controller.getSnapshot().conversationQueueDeliver.response.status,
      "idle"
    )
    controller.dispose()
  })
}

test("query failure cannot unlock an unknown queue mutation, but its definite host rejection can", async () => {
  let failure = new Error("network failure")
  const calls = []
  const controller = createRequestController(async (operation, input) => {
    calls.push({ operation, input })
    throw failure
  })
  controller.initialize(operations)
  controller.setInput(
    "conversationQueueMode",
    JSON.stringify(originalQueueInputs.conversationQueueMode)
  )
  await controller.run("conversationQueueMode", validateRequest)
  assert.equal(
    controller.getSnapshot().conversationQueueMode.response.status,
    "unknown"
  )
  const original =
    controller.getSnapshot().conversationQueueMode.response.queueReceiptInput
  controller.setInput("conversationQueueReceiptRead", JSON.stringify(original))
  await controller.run("conversationQueueReceiptRead", validateRequest)
  controller.clearResponse("conversationQueueReceiptRead")
  await controller.run("conversationQueueMode", validateRequest)
  assert.equal(
    calls.filter((call) => call.operation === "conversationQueueMode").length,
    1
  )
  controller.dispose()

  failure = Object.assign(new Error("队列版本已更新。"), {
    name: "RpcRequestRejected",
    issue: {
      code: "revision_conflict",
      summary: "队列版本已更新。",
      recovery: "reload",
      severity: "warning",
    },
  })
  const rejectedController = createRequestController(async () => {
    throw failure
  })
  rejectedController.initialize(operations)
  rejectedController.setInput(
    "conversationQueueMode",
    JSON.stringify(originalQueueInputs.conversationQueueMode)
  )
  await rejectedController.run("conversationQueueMode", validateRequest)
  assert.equal(
    rejectedController.getSnapshot().conversationQueueMode.response.status,
    "error"
  )
  assert.equal(
    rejectedController.getSnapshot().conversationQueueMode.response
      .queueReceiptInput,
    undefined
  )
  rejectedController.dispose()
})

test("formal request schema supplies optional write and authorization identities and preserves supplied IDs", async () => {
  const calls = []
  const controller = createRequestController(async (operation, input) => {
    calls.push({ operation, input })
    throw unknownQueueError()
  })
  controller.initialize(operations)
  controller.setInput(
    "remove",
    JSON.stringify({ id: "connection", revision: 1 })
  )
  await controller.run("remove", validateRequest)
  assert.equal(typeof calls[0].input.operationRequestId, "string")
  assert.deepEqual(controller.getSnapshot().remove.response.receiptInput, {
    operation: "remove",
    operationRequestId: calls[0].input.operationRequestId,
  })
  controller.setInput(
    "authStart",
    JSON.stringify({
      ...operations.authStart.example,
      operationRequestId: "provided-auth-id",
    })
  )
  await controller.run("authStart", validateRequest)
  assert.equal(calls[1].input.operationRequestId, "provided-auth-id")
  assert.deepEqual(
    controller.getSnapshot().authStart.response.authorizationInput,
    { id: "provided-auth-id" }
  )
  controller.dispose()
})

test("an unknown queue original blocks other writes for its SID and matching settlement clears only its redirects", async () => {
  const original = {
    sessionId: "queue-session",
    operationRequestId: "original-remove",
  }
  const calls = []
  const controller = createRequestController(async (operation, input) => {
    calls.push({ operation, input })
    if (operation === "conversationQueueRemove") throw unknownQueueError()
    if (operation === "conversationQueueReceiptRead")
      return {
        ...original,
        state: "committed",
        operation: "conversationQueueRemove",
        baseRevision: 7,
        itemId: "queue-item",
        revision: 8,
      }
    return { sessionId: input.sessionId }
  })
  controller.initialize(operations)
  controller.setInput(
    "conversationQueueRemove",
    JSON.stringify({
      ...originalQueueInputs.conversationQueueRemove,
      ...original,
    })
  )
  await controller.run("conversationQueueRemove", validateRequest)
  for (const operation of [
    "conversationQueueMode",
    "conversationQueueDeliver",
    "conversationQueueEdit",
  ]) {
    const input =
      operation === "conversationQueueEdit"
        ? {
            sessionId: "queue-session",
            itemId: "queue-item",
            text: "retain my draft",
            revision: 7,
          }
        : originalQueueInputs[operation]
    controller.setInput(operation, JSON.stringify(input))
    await controller.run(operation, validateRequest)
    assert.equal(calls.filter((call) => call.operation === operation).length, 0)
    assert.deepEqual(
      controller.getSnapshot()[operation].response.queueReceiptInput,
      original
    )
    assert.equal(
      controller.getSnapshot()[operation].response.queueBlockedSessionId,
      "queue-session"
    )
  }
  controller.setInput(
    "conversationQueueDeliver",
    JSON.stringify({
      ...originalQueueInputs.conversationQueueDeliver,
      sessionId: "independent-session",
    })
  )
  await controller.run("conversationQueueDeliver", validateRequest)
  assert.equal(
    calls.filter((call) => call.operation === "conversationQueueDeliver")
      .length,
    1
  )
  assert.equal(
    controller.getSnapshot().conversationQueueDeliver.response.status,
    "success"
  )
  await controller.run("providers", validateRequest)
  assert.equal(controller.getSnapshot().providers.response.status, "success")
  controller.setInput("conversationQueueReceiptRead", JSON.stringify(original))
  await controller.run("conversationQueueReceiptRead", validateRequest)
  assert.equal(
    controller.getSnapshot().conversationQueueMode.response.status,
    "idle"
  )
  assert.equal(
    controller.getSnapshot().conversationQueueEdit.response.status,
    "idle"
  )
  assert.equal(
    controller.getSnapshot().conversationQueueDeliver.response.status,
    "success"
  )
  assert.equal(
    calls.filter((call) => call.operation === "conversationQueueRemove").length,
    1
  )
  assert.match(
    controller.getSnapshot().conversationQueueEdit.input,
    /retain my draft/
  )
  controller.dispose()
})
