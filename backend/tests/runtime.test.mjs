import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, access, mkdir, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { once } from "node:events"
import { fileURLToPath } from "node:url"

async function fixture(t, { execArgv = [] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moon-runtime-test-"))
  const file = join(directory, "runtime.json")
  const env = {
    ...process.env,
    MOON_DATA_DIR: directory,
    MOON_RUNTIME_FILE: file,
  }
  const child = spawn(
    process.execPath,
    [...execArgv, fileURLToPath(new URL("../rpc.mjs", import.meta.url))],
    { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
  )
  const exited = once(child, "exit")
  const callbacks = new Map()
  const lines = createInterface({ input: child.stdout })
  lines.on("line", (line) => {
    const reply = JSON.parse(line)
    callbacks.get(reply.id)?.(reply)
    callbacks.delete(reply.id)
  })
  let next = 0
  function call(operation, input = {}) {
    return new Promise((resolve) => {
      const id = String(++next)
      callbacks.set(id, resolve)
      child.stdin.write(JSON.stringify({ id, operation, input }) + "\n")
    })
  }
  t.after(async () => {
    child.stdin.end()
    await exited
    lines.close()
    await rm(directory, { recursive: true, force: true })
  })
  const ready = await call("$runtime")
  assert.ok(ready.result.instance)
  const info = JSON.parse(await readFile(file, "utf8"))
  async function http(operation, input = {}, token = info.token) {
    return fetch(`http://127.0.0.1:${info.port}/api/models/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-moon-token": token },
      body: JSON.stringify(input),
    })
  }
  return { child, exited, call, http, info, file, env }
}
test(
  "desktop RPC and browser HTTP share one instance, credentials and lifecycle",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t)
    const health = await fetch(`http://127.0.0.1:${f.info.port}/health`, {
      headers: { "x-moon-token": f.info.token },
    }).then((r) => r.json())
    assert.equal(health.instance, (await f.call("$runtime")).result.instance)
    assert.equal((await f.http("list", {}, "bad-token")).status, 403)
    const saved = await f.call("save", {
      connection: {
        id: "shared",
        name: "Shared",
        kind: "api",
        endpoint: "http://localhost:12345/v1",
        protocol: "openai-completions",
        credential: "key",
        keySaved: false,
        apiKey: "disposable-test-secret",
        environmentVariable: "",
        headers: "{}",
        models: [],
      },
    })
    assert.ok(saved.result, saved.error)
    const rows = await f.http("list").then((r) => r.json())
    assert.equal(rows.result[0].id, "shared")
    assert.equal(rows.result[0].apiKey, "")
    const revision = rows.result[0].revision
    assert.equal(
      (
        await f
          .http("revealKey", { id: "shared", revision })
          .then((r) => r.json())
      ).result.apiKey,
      "disposable-test-secret"
    )
    assert.match(
      (await f.call("revealKey", { id: "shared", revision: revision + 1 }))
        .error,
      /更新/
    )
    assert.match(
      (await f.call("revealKey", { id: "missing", revision })).error,
      /不存在/
    )
    const duplicate = spawn(
      process.execPath,
      [fileURLToPath(new URL("../rpc.mjs", import.meta.url))],
      { env: f.env, stdio: ["pipe", "ignore", "ignore"], windowsHide: true }
    )
    const [code] = await once(duplicate, "exit")
    assert.notEqual(code, 0)
    assert.equal((await f.call("$runtime")).result.instance, health.instance)
    f.child.stdin.end()
    await f.exited
    await assert.rejects(access(f.file))
    await assert.rejects(access(`${f.file}.lock`))
  }
)

test("runtime publish failure removes its temporary file and lock", async (t) => {
  const { startRuntime } = await import("../runtime.mjs")
  const directory = await mkdtemp(join(tmpdir(), "moon-runtime-publish-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, "runtime.json")
  await mkdir(file)
  await assert.rejects(
    startRuntime(
      file,
      async () => null,
      () => "失败"
    )
  )
  assert.deepEqual(await readdir(directory), ["runtime.json"])
})

test(
  "transport handshake and health do not wait for Pi imports longer than native startup deadline",
  { timeout: 50000 },
  async (t) => {
    // Delay only the real models module using Node's loader API. Production has
    // no test delay flag and still loads the actual Pi dependency graph.
    const loader = `import { setTimeout as delay } from 'node:timers/promises';
    export async function load(url, context, nextLoad) {
      if (url.endsWith('/models.mjs')) await delay(31000);
      return nextLoad(url, context);
    }`
    const hook = `import { register } from 'node:module'; register(${JSON.stringify("data:text/javascript," + encodeURIComponent(loader))}, import.meta.url);`
    const start = Date.now()
    const f = await fixture(t, {
      execArgv: [
        "--import",
        "data:text/javascript," + encodeURIComponent(hook),
      ],
    })
    assert.ok(
      Date.now() - start < 10000,
      "desktop can open before Pi finishes importing"
    )
    const listing = f.call("list")
    const second = f.call("list")
    assert.equal((await f.call("$runtime")).result.instance, f.info.instance)
    const health = await fetch(`http://127.0.0.1:${f.info.port}/health`, {
      headers: { "x-moon-token": f.info.token },
    })
    assert.equal(health.status, 200)
    assert.deepEqual((await listing).result, [])
    assert.deepEqual((await second).result, [])
    assert.ok(
      Date.now() - start >= 31000,
      "the injected slow import actually ran"
    )
  }
)
