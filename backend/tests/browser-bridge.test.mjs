import test from "node:test"
import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { Readable } from "node:stream"
import { readJsonBody } from "../http-body.mjs"
import { modelBackendPlugin, bridgeWaitMs } from "../bridge.mjs"
import { startRuntime } from "../runtime.mjs"
import { WorkspaceService } from "../workspaces.mjs"
import {
  connectDirectoryHost,
  acceptDirectoryReply,
  closeDirectoryHost,
  pickNativeDirectory,
} from "../native-directory.mjs"

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture(t, dispatchOverride) {
  const directory = await mkdtemp(join(tmpdir(), "moon-browser-bridge-"))
  const cwd = join(directory, "current")
  const other = join(directory, "chosen")
  await mkdir(cwd)
  await mkdir(other)
  const service = new WorkspaceService(join(directory, "data"), {
    cwd,
    pickDirectory: pickNativeDirectory,
  })
  await service.list()
  const file = join(directory, "runtime.json")
  const previous = process.env.MOON_RUNTIME_FILE
  process.env.MOON_RUNTIME_FILE = file
  const runtime = await startRuntime(
    file,
    dispatchOverride ??
      ((operation, _, signal) => {
        assert.equal(operation, "workspaceChoose")
        return service.choose(signal)
      }),
    (error) => error.message
  )
  let middleware
  modelBackendPlugin().configureServer({
    middlewares: {
      use: (prefix, handler) => {
        assert.equal(prefix, "/api/models/")
        middleware = handler
      },
    },
  })
  const proxy = createServer((req, res) => {
    req.url = req.url.slice("/api/models".length)
    void middleware(req, res)
  })
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve))
  t.after(async () => {
    closeDirectoryHost()
    proxy.closeAllConnections()
    await new Promise((resolve) => proxy.close(resolve))
    await runtime.close()
    service.close()
    if (previous === undefined) delete process.env.MOON_RUNTIME_FILE
    else process.env.MOON_RUNTIME_FILE = previous
    await rm(directory, { recursive: true, force: true })
  })
  function call(operation = "workspaceChoose", signal) {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: proxy.address().port,
          path: `/api/models/${operation}`,
          method: "POST",
          headers: { "content-type": "application/json" },
          signal,
        },
        (res) => {
          let body = ""
          res.setEncoding("utf8")
          res.on("data", (chunk) => {
            body += chunk
          })
          res.once("error", reject)
          res.once("end", () =>
            resolve({ status: res.statusCode, ...JSON.parse(body) })
          )
        }
      )
      req.once("error", reject)
      req.end("{}")
    })
  }
  return { runtime, service, other, call, proxyPort: proxy.address().port }
}

test("browser proxy keeps native directory choice pending beyond 300s and registers its real result", async (t) => {
  const f = await fixture(t)
  const picked = deferred()
  connectDirectoryHost(picked.resolve)
  // Advance only the application timers; HTTP uses real loopback sockets and
  // the actual proxy/runtime/directory/workspace modules. No five-minute sleep.
  t.mock.timers.enable({ apis: ["setTimeout"] })
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("implicit fetch deadline must not be used")
  })
  let settled = false
  const pending = f.call().finally(() => {
    settled = true
  })
  const nativeRequest = await picked.promise
  t.mock.timers.tick(300_001)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(bridgeWaitMs("workspaceChoose"), 610_000)
  acceptDirectoryReply({
    operation: "$hostReply",
    id: nativeRequest.id,
    result: f.other,
  })
  const response = await pending
  assert.equal(response.status, 200)
  assert.equal(response.result.path, f.other)
  assert.equal((await f.service.list()).selectedId, response.result.id)
})

test("directory host's 600s timeout reaches browser as a selection error before proxy deadline", async (t) => {
  const f = await fixture(t)
  const picked = deferred()
  connectDirectoryHost(picked.resolve)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const pending = f.call()
  await picked.promise
  t.mock.timers.tick(600_001)
  const response = await pending
  assert.equal(response.status, 400)
  assert.match(response.error, /目录选择等待已超时/)
  assert.doesNotMatch(response.error, /无法连接/)
  assert.equal((await f.service.list()).items.length, 1)
})

test("browser cancellation reaches directory capability and discards the late host reply", async (t) => {
  const f = await fixture(t)
  const picked = deferred()
  const cancelled = deferred()
  connectDirectoryHost(picked.resolve)
  const choose = f.service.choose.bind(f.service)
  f.service.choose = async (signal) => {
    try {
      return await choose(signal)
    } finally {
      if (signal.aborted) cancelled.resolve()
    }
  }
  const controller = new AbortController()
  const pending = f.call("workspaceChoose", controller.signal)
  const rejected = assert.rejects(pending, { name: "AbortError" })
  const nativeRequest = await picked.promise
  controller.abort()
  await rejected
  await cancelled.promise
  acceptDirectoryReply({
    operation: "$hostReply",
    id: nativeRequest.id,
    result: f.other,
  })
  assert.equal((await f.service.list()).items.length, 1)
})

test("explicit proxy response deadline cancels a stalled host request without calling it disconnected", async (t) => {
  const entered = deferred()
  const cancelled = deferred()
  const f = await fixture(t, async (operation, _, signal) => {
    assert.equal(operation, "list")
    entered.resolve()
    return new Promise((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          cancelled.resolve()
          reject(new Error("请求已取消。"))
        },
        { once: true }
      )
    })
  })
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const pending = f.call("list")
  await entered.promise
  assert.equal(bridgeWaitMs("list"), 60_000)
  t.mock.timers.tick(60_001)
  const response = await pending
  await cancelled.promise
  assert.equal(response.status, 400)
  assert.match(response.error, /响应超时/)
  assert.doesNotMatch(response.error, /无法连接|重启/)
})

test("HTTP host and browser proxy preserve Chinese and emoji at every byte boundary", async (t) => {
  const f = await fixture(t, async (_operation, input) => input)
  const input = { text: "中文消息🌙", name: "配置" }
  const body = Buffer.from(JSON.stringify(input))
  for (const direct of [true, false]) {
    for (let split = 1; split < body.length; split++) {
      const result = await new Promise((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port: direct ? f.runtime.info.port : f.proxyPort,
            path: "/api/models/echo",
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(direct ? { "x-moon-token": f.runtime.info.token } : {}),
            },
          },
          (res) => {
            let text = ""
            res.setEncoding("utf8")
            res.on("data", (chunk) => {
              text += chunk
            })
            res.on("error", reject)
            res.on("end", () => {
              try {
                resolve(JSON.parse(text))
              } catch (error) {
                reject(error)
              }
            })
          }
        )
        req.on("error", reject)
        req.write(body.subarray(0, split))
        void delay(5).then(() => req.end(body.subarray(split)))
      })
      assert.deepEqual(
        result.result,
        input,
        `${direct ? "host" : "proxy"} split ${split}`
      )
    }
  }
})

test("JSON body limit counts bytes including multibyte text and rejects malformed JSON", async () => {
  const limit = 1024 * 1024
  const allowed = Buffer.from('"' + "a".repeat(limit - 2) + '"')
  assert.equal((await readJsonBody(Readable.from([allowed]))).length, limit - 2)
  await assert.rejects(
    readJsonBody(
      Readable.from([
        Buffer.from('"' + "中".repeat(Math.ceil(limit / 3)) + '"'),
      ])
    ),
    /请求过大/
  )
  await assert.rejects(
    readJsonBody(Readable.from([Buffer.from("{bad")])),
    SyntaxError
  )
})
