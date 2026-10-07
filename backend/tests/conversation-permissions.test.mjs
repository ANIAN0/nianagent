import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ModelService } from "../models.mjs"

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "moon-conversation-permissions-"))
  const directory = join(root, "data")
  const service = new ModelService(directory)
  await service.initialize()
  t.after(async () => {
    await service.close()
    await rm(root, { recursive: true, force: true })
  })
  const read = (sessionId = "permission-test") =>
    service.dispatch("conversationPermissionRead", { sessionId })
  const set = (sessionId, mode, revision) =>
    service.dispatch("conversationPermissionSet", { sessionId, mode, revision })
  return { root, directory, service, read, set }
}

test("conversationPermissionRead defaults an unsaved session to workspace mode revision 0", async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await f.read(), {
    sessionId: "permission-test",
    mode: "workspace",
    revision: 0,
  })
})

test("conversationPermissionSet persists and read returns the same mode and revision", async (t) => {
  const f = await fixture(t)
  const first = await f.set("permission-test", "read-only", 0)
  assert.deepEqual(first, {
    sessionId: "permission-test",
    mode: "read-only",
    revision: 1,
  })
  assert.deepEqual(await f.read(), first)
  // 相同模式重复设置幂等，revision 不增长。
  assert.deepEqual(await f.set("permission-test", "read-only", 1), first)
  // 修改模式必须携带最新 revision。
  const full = await f.set("permission-test", "full-access", 1)
  assert.deepEqual(full, {
    sessionId: "permission-test",
    mode: "full-access",
    revision: 2,
  })
  assert.deepEqual(await f.read(), full)
})

test("conversationPermissionSet rejects a stale revision without overwriting", async (t) => {
  const f = await fixture(t)
  await f.set("permission-test", "read-only", 0)
  await assert.rejects(
    f.set("permission-test", "full-access", 0),
    /权限配置已变化/
  )
  assert.deepEqual(await f.read(), {
    sessionId: "permission-test",
    mode: "read-only",
    revision: 1,
  })
})

test("saved conversation permissions survive a service restart", async (t) => {
  const f = await fixture(t)
  await f.set("permission-test", "read-only", 0)
  await f.service.close()
  const restarted = new ModelService(f.directory)
  await restarted.initialize()
  t.after(() => restarted.close())
  assert.deepEqual(
    await restarted.dispatch("conversationPermissionRead", {
      sessionId: "permission-test",
    }),
    { sessionId: "permission-test", mode: "read-only", revision: 1 }
  )
})

test("conversationPermissionRead rejects invalid session identities", async (t) => {
  const f = await fixture(t)
  // 契约层拒绝格式不合法的标识。
  await assert.rejects(f.read("invalid id!"), /格式不正确/)
  // 服务层拒绝通过契约模式但禁止使用的标识（原型污染防护）。
  await assert.rejects(f.read("__proto__"), /会话标识无效/)
})
