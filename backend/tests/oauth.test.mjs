import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, basename, sep } from "node:path"
import { ModelStore } from "../store.mjs"
import { AuthorizationJobs } from "../oauth.mjs"

test("OAuth prompts, replies, cancellation and failed re-login retain correct terminal state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moon-oauth-test-"))
  const store = new ModelStore(directory)
  await store.initialize()
  const saved = {
    id: "subscription",
    name: "Subscription",
    endpoint: "",
    credential: "none",
    environmentVariable: "",
    headers: "{}",
    models: [],
    kind: "subscription",
    providerId: "fixture",
    revision: 1,
  }
  let mode = "prompt"
  let input
  let saves = 0
  const service = {
    store,
    save: async () => {
      saves++
      await store.update((data) => {
        data.connections = [saved]
      })
      return saved
    },
    list: async () => [{ ...saved, account: { loggedIn: true } }],
    runtime: async () => ({
      login: async (_id, _method, interaction) => {
        if (mode === "fail") throw new Error("provider refused login")
        interaction.notify({ type: "info", message: "fixture only" })
        input = await interaction.prompt({
          type: "select",
          message: "Choose",
          options: [{ id: "yes", label: "Yes" }],
        })
      },
    }),
  }
  const jobs = new AuthorizationJobs(service)
  try {
    await assert.rejects(jobs.start({ kind: "api" }), /订阅连接/)
    assert.equal(saves, 0)
    const first = await jobs.start(saved)
    assert.equal(first.status, "pending")
    assert.equal(first.events[0].message, "fixture only")
    assert.throws(
      () => jobs.reply(first.id, first.prompt.id, "invalid"),
      /选项无效/
    )
    jobs.reply(first.id, first.prompt.id, "yes")
    await jobs.jobs.get(first.id).done
    assert.equal(input, "yes")
    assert.equal(jobs.poll(first.id).status, "complete")
    assert.deepEqual((await store.read()).authorizations, {})
    const second = await jobs.start(saved)
    await jobs.cancel(second.id)
    assert.equal(jobs.poll(second.id).status, "cancelled")
    assert.equal(jobs.poll(second.id).prompt, undefined)
    assert.deepEqual((await store.read()).authorizations, {})
    mode = "fail"
    const third = await jobs.start(saved)
    await jobs.jobs.get(third.id).done
    assert.equal(jobs.poll(third.id).status, "error")
  } finally {
    await jobs.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("a known original authorization ID cancels preparation, closes resources and cannot restart after expiry or a new host", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-oauth-identity-"))
  const store = new ModelStore(directory)
  await store.initialize()
  const connection = { id: "subscription", name: "Subscription", endpoint: "", credential: "none", environmentVariable: "", headers: "{}", models: [], kind: "subscription", providerId: "fixture", revision: 1 }
  let saves = 0
  let logins = 0
  let resumeSave
  let savedStarted
  const saving = new Promise((resolve) => { savedStarted = resolve })
  const gate = new Promise((resolve) => { resumeSave = resolve })
  const service = {
    store,
    save: async (_connection, signal) => {
      saves++
      savedStarted()
      await gate
      await store.update((data) => { data.connections = [connection] }, signal)
      return connection
    },
    list: async () => [connection],
    runtime: async () => ({ login: async () => { logins++ } }),
  }
  const jobs = new AuthorizationJobs(service)
  const secondHost = new AuthorizationJobs(service)
  t.after(async () => {
    await jobs.close()
    await secondHost.close()
    assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + sep), true)
    assert.equal(basename(directory).startsWith("moon-oauth-identity-"), true)
    await rm(directory, { recursive: true, force: true })
  })
  const original = jobs.start(connection, undefined, "original-authorization")
  const originalResult = assert.rejects(original, { name: "AbortError" })
  await saving
  assert.equal(jobs.poll("original-authorization").stage, "preparing")
  const cancellation = jobs.cancel("original-authorization")
  resumeSave()
  await cancellation
  await originalResult
  assert.equal(jobs.poll("original-authorization").status, "cancelled")
  assert.equal(saves, 1)
  assert.equal(logins, 0)
  assert.deepEqual((await store.read()).connections, [])
  assert.equal((await store.read()).authorizationRequests["original-authorization"].status, "cancelled")
  assert.throws(() => jobs.poll("missing-original"), (error) => error.issue.recovery === "check")
  await assert.rejects(jobs.cancel("missing-original"), (error) => error.issue.code === "authorization_unknown")
  jobs.jobs.delete("original-authorization")
  await assert.rejects(secondHost.start(connection, undefined, "original-authorization"), (error) => error.issue.code === "authorization_already_started")
  await assert.rejects(secondHost.start({ ...connection, name: "Changed" }, undefined, "original-authorization"), (error) => error.issue.code === "authorization_identity_conflict")
  assert.equal(saves, 1)
  assert.equal(logins, 0)
  assert.equal((await store.read()).authorizationRequests["original-authorization"].status, "cancelled")
})

test("duplicate start retains the original job and shutdown waits for login cancellation and lease release", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-oauth-close-"))
  const store = new ModelStore(directory)
  await store.initialize()
  const connection = { id: "subscription", name: "Subscription", endpoint: "", credential: "none", environmentVariable: "", headers: "{}", models: [], kind: "subscription", providerId: "fixture", revision: 1 }
  let saves = 0
  let stopped = false
  const service = {
    store,
    save: async () => { saves++; await store.update((data) => { data.connections = [connection] }); return connection },
    list: async () => [connection],
    runtime: async () => ({ login: async (_id, _method, interaction) => {
      await new Promise((resolve) => { interaction.signal.addEventListener("abort", resolve, { once: true }); if (interaction.signal.aborted) resolve() })
      stopped = true
      throw interaction.signal.reason
    } }),
  }
  const jobs = new AuthorizationJobs(service)
  t.after(async () => { await jobs.close(); assert.equal(basename(directory).startsWith("moon-oauth-close-"), true); assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + sep), true); await rm(directory, { recursive: true, force: true }) })
  const first = await jobs.start(connection, undefined, "same-original")
  const second = await jobs.start(connection, undefined, "same-original")
  assert.equal(second.id, first.id)
  assert.equal(saves, 1)
  await jobs.close()
  assert.equal(stopped, true)
  assert.equal(jobs.poll(first.id).status, "cancelled")
  assert.deepEqual((await store.read()).authorizations, {})
  assert.equal((await store.read()).authorizationRequests[first.id].status, "cancelled")
})
