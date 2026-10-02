import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
    jobs.close()
    await rm(directory, { recursive: true, force: true })
  }
})
