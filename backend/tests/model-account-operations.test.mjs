import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, basename, sep } from "node:path"
import { ModelService } from "../models.mjs"

const gate = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const connection = (id = "account-one", providerId = "fixture-one") => ({
  id, providerId, revision: 1, name: id, kind: "subscription", endpoint: "", credential: "none",
  environmentVariable: "", headers: "{}", models: [],
})
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-account-operation-"))
  const service = new ModelService(directory)
  await service.initialize()
  const first = connection()
  const second = connection("account-two", "fixture-two")
  await service.store.update((document) => {
    document.connections = [first, second]
    for (const item of document.connections) document.credentials[item.providerId] = { type: "oauth", access: "local-access", refresh: "local-refresh", expires: Date.now() + 60000 }
  })
  service.providers = async () => [{ id: first.providerId, name: first.name }, { id: second.providerId, name: second.name }]
  t.after(async () => {
    await service.close()
    assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + sep), true)
    assert.equal(basename(directory).startsWith("moon-account-operation-"), true)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { service, first, second }
}

test("credential deletion is not SDK settlement: provider busy remains authoritative and another provider stays usable", async (t) => {
  const { service, first, second } = await fixture(t)
  const deleted = gate()
  const synchronization = gate()
  let calls = 0
  service.runtime = async () => ({ logout: async (providerId, options) => {
    calls++
    await service.store.credentialStore().delete(providerId, options)
    if (providerId === first.providerId) { deleted.resolve(); await synchronization.promise }
    options.signal.throwIfAborted()
  } })
  const running = service.dispatch("logout", { id: first.id })
  try {
    await deleted.promise
    const current = (await service.dispatch("list", {})).find((item) => item.id === first.id)
    assert.equal(current.account.loggedIn, false)
    assert.equal(current.accountOperationBusy, true)
    await assert.rejects(service.logout(first.id), (error) => error.issue?.code === "account_operation_busy")
    await assert.rejects(service.jobs.start({ ...current, apiKey: "", keySaved: false }, undefined, "new-during-logout"), (error) => error.issue?.code === "account_operation_busy")
    await assert.rejects(service.save(current), (error) => error.issue?.code === "account_operation_busy")
    await assert.rejects(service.remove(first.id, first.revision), (error) => error.issue?.code === "account_operation_busy")
    assert.equal((await service.logout(second.id)).accountOperationBusy, false)
    assert.equal(calls, 2)
    assert.equal((await service.store.read()).authorizationRequests?.["new-during-logout"], undefined)
  } finally { synchronization.resolve(); await running }
  const completed = (await service.list()).find((item) => item.id === first.id)
  assert.equal(completed.accountOperationBusy, false)
  assert.equal(Object.hasOwn((await service.store.read()).connections[0], "accountOperationBusy"), false)
})

test("transport cancellation cannot clear provider busy before the SDK promise exits", async (t) => {
  const { service, first } = await fixture(t)
  const controller = new AbortController()
  const deleted = gate()
  const synchronization = gate()
  service.runtime = async () => ({ logout: async (providerId, options) => {
    await service.store.credentialStore().delete(providerId, options)
    deleted.resolve()
    await synchronization.promise
    options.signal.throwIfAborted()
  } })
  const running = service.logout(first.id, controller.signal)
  const rejected = assert.rejects(running, { name: "AbortError" })
  try {
    await deleted.promise
    controller.abort()
    assert.equal((await service.list())[0].accountOperationBusy, true)
    await assert.rejects(service.logout(first.id), (error) => error.issue?.code === "account_operation_busy")
  } finally { synchronization.resolve(); await rejected }
  assert.equal((await service.list())[0].accountOperationBusy, false)
  assert.equal((await service.list())[0].account.loggedIn, false)
})

test("host close aborts logout and waits for SDK cleanup before releasing provider ownership", async (t) => {
  const { service, first } = await fixture(t)
  const started = gate()
  const aborted = gate()
  const cleanup = gate()
  let released = false
  service.runtime = async () => ({ logout: async (_providerId, options) => {
    options.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
    started.resolve()
    await aborted.promise
    await cleanup.promise
    released = true
    options.signal.throwIfAborted()
  } })
  const running = service.logout(first.id)
  const rejected = assert.rejects(running, { name: "AbortError" })
  await started.promise
  let closed = false
  const shutdown = service.close().then(() => { closed = true })
  try {
    await aborted.promise
    assert.equal(closed, false)
    assert.equal(released, false)
    assert.equal((await service.list())[0].accountOperationBusy, true)
  } finally { cleanup.resolve(); await rejected; await shutdown }
  assert.equal(released, true)
  assert.equal(service.accountLogouts.size, 0)
})

test("OAuth terminal status does not release the provider until the original lease cleanup settles", async (t) => {
  const { service, first } = await fixture(t)
  const cleanupStarted = gate()
  const cleanup = gate()
  const releaseLease = service.jobs.releaseLease.bind(service.jobs)
  service.jobs.releaseLease = async (job) => { cleanupStarted.resolve(); await cleanup.promise; return releaseLease(job) }
  service.runtime = async () => ({ login: async () => {}, logout: async (providerId, options) => service.store.credentialStore().delete(providerId, options) })
  const input = { ...first, apiKey: "", keySaved: false }
  const original = await service.jobs.start(input, undefined, "original-account-auth")
  try {
    await cleanupStarted.promise
    const published = await service.dispatch("authPoll", { id: original.id })
    assert.equal(published.status, "pending")
    assert.equal(published.stage, "settling")
    assert.equal(published.prompt, undefined)
    assert.equal(service.jobs.hasConnection(first.id), true)
    assert.equal(service.jobs.hasProvider(first.providerId), true)
    await assert.rejects(service.logout(first.id), /清理结束/)
    await assert.rejects(service.jobs.start({ ...input, revision: 2 }, undefined, "auth-during-cleanup"), /正在授权/)
    await assert.rejects(service.remove(first.id, 2), /授权/)
  } finally { cleanup.resolve(); await service.jobs.jobs.get(original.id).done }
  assert.equal(service.jobs.hasConnection(first.id), false)
  assert.equal(service.jobs.hasProvider(first.providerId), false)
  assert.equal((await service.dispatch("authPoll", { id: original.id })).status, "complete")
  assert.equal((await service.logout(first.id)).accountOperationBusy, false)
})

test("failed original OAuth cleanup keeps the published ID and warning until authCancel recovery really finishes", async (t) => {
  const { service, first } = await fixture(t)
  const recoveryStarted = gate()
  const recovery = gate()
  const releaseLease = service.jobs.releaseLease.bind(service.jobs)
  let releases = 0
  service.jobs.releaseLease = async (job) => {
    if (++releases === 1) throw new Error("PRIVATE_LEASE_CLEANUP_FAILURE")
    recoveryStarted.resolve()
    await recovery.promise
    return releaseLease(job)
  }
  service.runtime = async () => ({ login: async () => {} })
  const original = await service.jobs.start({ ...first, apiKey: "", keySaved: false }, undefined, "recover-original-cleanup")
  await service.jobs.jobs.get(original.id).done
  const failed = await service.dispatch("authPoll", { id: original.id })
  assert.equal(failed.id, original.id)
  assert.equal(failed.status, "complete")
  assert.equal(failed.issue.code, "authorization_cleanup")
  assert.equal(failed.issue.recovery, "check")
  assert.equal(JSON.stringify(failed).includes("PRIVATE_LEASE_CLEANUP_FAILURE"), false)
  assert.equal(service.jobs.hasProvider(first.providerId), true)
  const cancellation = service.dispatch("authCancel", { id: original.id })
  try {
    await recoveryStarted.promise
    const pending = await service.dispatch("authPoll", { id: original.id })
    assert.equal(pending.id, original.id)
    assert.equal(pending.issue.code, "authorization_cleanup")
    assert.equal(service.jobs.hasProvider(first.providerId), true)
  } finally { recovery.resolve(); await cancellation }
  const completed = await service.dispatch("authPoll", { id: original.id })
  assert.equal(completed.status, "complete")
  assert.equal(completed.issue, undefined)
  assert.equal(service.jobs.hasProvider(first.providerId), false)
  assert.equal((await service.store.read()).authorizations[first.providerId], undefined)
  assert.equal((await service.store.read()).authorizationRequests[original.id].status, "complete")
})
