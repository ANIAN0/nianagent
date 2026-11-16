import test from "node:test"
import assert from "node:assert/strict"
import { createV2Service } from "./service.mjs"

test("领域关闭取消在途导入、等待收尾并拒绝新调用，三入口共用生命周期", async () => {
  let started, finish, observedSignal
  const entered = new Promise((resolve) => {
    started = resolve
  })
  const settle = new Promise((resolve) => {
    finish = resolve
  })
  const service = createV2Service(
    {
      async stagePackage(_source, _kind, _actor, { signal }) {
        observedSignal = signal
        started()
        await settle
        signal.throwIfAborted()
      },
    },
    { event() {} }
  )
  const tool = service.sharedTools.find((item) => item.name === "stage_package")
  const pending = tool.execute(
    { sourceDir: "fixture", kind: "ui" },
    { source: "mcp", actorId: "A" }
  )
  await entered
  let closed = false
  const closing = service.close().then(() => {
    closed = true
  })
  assert.equal(observedSignal.aborted, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closed, false)
  await assert.rejects(
    service.operations.v2_list_projects.execute({}, { source: "local" }),
    { code: "cancelled" }
  )
  finish()
  const result = await pending
  assert.equal(result.isError, true)
  await closing
  assert.equal(closed, true)
  await service.close()
})
