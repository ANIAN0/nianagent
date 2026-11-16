// @ts-check
// MCP 身份登记表回归测试（实现方案 §11 R1：Q09 反例固化）。
// 隔离临时目录运行；持久化失败用真实文件系统注入（目录占位），不使用替身。
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  authenticate,
  loadRegistry,
  registerAgent,
  revokeCredential,
  rotateActor,
  MAX_VALID_CREDENTIALS,
} from "./identity.mjs"

/** 建立隔离目录 + 已登记一个 Agent 的登记表。 */
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-identity-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const registry = await loadRegistry(directory)
  const { credential, token } = await registerAgent(
    directory,
    registry,
    "Agent A"
  )
  return { directory, registry, credential, token }
}

/** 让持久化真实失败：把登记表文件位置替换为目录（Windows/POSIX 均不可写为文件）。 */
async function blockPersistence(directory) {
  const file = join(directory, "credentials.json")
  await rm(file)
  await mkdir(file)
}

test("Q09 已存在的坏登记表（null）不重置、明确报错、原文件保留", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-identity-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, "credentials.json")
  await writeFile(file, "null")
  await assert.rejects(() => loadRegistry(directory))
  assert.equal(await readFile(file, "utf8"), "null", "坏文件不得被重写")
})

test("Q09 已存在的结构无效登记表不重置、明确报错", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-identity-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, "credentials.json")
  await writeFile(
    file,
    JSON.stringify({ revision: "broken", actors: {}, credentials: false })
  )
  await assert.rejects(() => loadRegistry(directory))
  assert.equal(
    await readFile(file, "utf8"),
    JSON.stringify({ revision: "broken", actors: {}, credentials: false })
  )
})

test("Q09 撤销持久化失败：内存与磁盘保持一致（不得先撤销内存）", async (t) => {
  const { directory, registry, credential, token } = await setup(t)
  await blockPersistence(directory)
  await assert.rejects(() =>
    revokeCredential(directory, registry, credential.credentialId)
  )
  // 持久化失败后：内存中凭据仍然有效，认证不被破坏
  const principal = authenticate(registry, `Bearer ${token}`)
  assert.ok(principal, "持久化失败不得使内存先变更（撤销未落盘）")
  assert.equal(
    registry.credentials.find(
      (item) => item.credentialId === credential.credentialId
    ).revokedAt,
    null
  )
})

test("Q09 轮换持久化失败：旧凭据保持有效、新凭据不进入内存", async (t) => {
  const { directory, registry, credential, token } = await setup(t)
  await blockPersistence(directory)
  await assert.rejects(() =>
    rotateActor(directory, registry, credential.actorId)
  )
  assert.ok(authenticate(registry, `Bearer ${token}`), "旧凭据在内存中仍须有效")
  const actorCredentials = registry.credentials.filter(
    (item) => item.actorId === credential.actorId
  )
  assert.equal(actorCredentials.length, 1, "新凭据不得在持久化失败后进入内存")
})

test("Q09 满额有效凭据下轮换不被配额阻塞（净数量不变）", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-identity-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const registry = await loadRegistry(directory)
  let last
  for (let index = 0; index < MAX_VALID_CREDENTIALS; index++) {
    last = await registerAgent(directory, registry, `Agent ${index}`)
  }
  await assert.rejects(
    () => registerAgent(directory, registry, "超出"),
    (error) => /上限/.test(error.message)
  )
  // 轮换不增加有效凭据数量，应成功
  const rotated = await rotateActor(directory, registry, last.actor.actorId)
  assert.ok(rotated.token)
  const valid = registry.credentials.filter((item) => !item.revokedAt).length
  assert.equal(valid, MAX_VALID_CREDENTIALS)
})

test("Q09 归档文件无效时启动即报错、原文件保留（不等待归档触发）", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-identity-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const registry = await loadRegistry(directory)
  await registerAgent(directory, registry, "Agent A")
  const broken = JSON.stringify({ archived: "broken" })
  await writeFile(join(directory, "credentials-archive.json"), broken)
  await assert.rejects(() => loadRegistry(directory))
  assert.equal(
    await readFile(join(directory, "credentials-archive.json"), "utf8"),
    broken
  )
})

test("已撤销 actor 的轮换不得突破有效凭据配额", async (t) => {
  const { directory, registry, credential } = await setup(t)
  await revokeCredential(directory, registry, credential.credentialId)
  for (let index = 0; index < MAX_VALID_CREDENTIALS; index++) {
    await registerAgent(directory, registry, `Agent ${index}`)
  }
  const before = await readFile(join(directory, "credentials.json"), "utf8")
  const revision = registry.revision
  await assert.rejects(
    () => rotateActor(directory, registry, credential.actorId),
    (error) => /上限/.test(error.message)
  )
  assert.equal(registry.revision, revision)
  assert.equal(
    registry.credentials.filter((item) => !item.revokedAt).length,
    MAX_VALID_CREDENTIALS
  )
  assert.equal(
    await readFile(join(directory, "credentials.json"), "utf8"),
    before
  )
})

test("Q09 幂等撤销：重复撤销返回未变化且不产生新写入错误", async (t) => {
  const { directory, registry, credential } = await setup(t)
  const first = await revokeCredential(
    directory,
    registry,
    credential.credentialId
  )
  assert.equal(first.changed, true)
  const second = await revokeCredential(
    directory,
    registry,
    credential.credentialId
  )
  assert.equal(second.changed, false)
})

test("登记持久化失败不会在内存留下已签发凭据", async (t) => {
  const { directory, registry, token } = await setup(t)
  const before = structuredClone(registry)
  await blockPersistence(directory)
  await assert.rejects(() => registerAgent(directory, registry, "Agent B"))
  assert.deepEqual(registry, before)
  assert.ok(authenticate(registry, `Bearer ${token}`))
})

test("轮换后重新加载保持 actor，旧凭据失效且新凭据可认证", async (t) => {
  const { directory, registry, credential, token } = await setup(t)
  const rotated = await rotateActor(directory, registry, credential.actorId)
  const reopened = await loadRegistry(directory)
  assert.equal(authenticate(reopened, `Bearer ${token}`), null)
  assert.deepEqual(authenticate(reopened, `Bearer ${rotated.token}`), {
    actorId: credential.actorId,
    credentialId: rotated.credential.credentialId,
  })
})
