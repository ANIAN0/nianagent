import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { entryState, softwareService } from "./software.mjs"

test("OpenCLI入口真实文件、缺失与文件系统拒绝保持不同结论", async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), "moon-software-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const entry = join(directory, "cli.js")
  await fs.writeFile(entry, "// probe only; never executed")
  assert.deepEqual(await entryState(directory, entry), { state: "available" })
  assert.deepEqual(await entryState(directory, join(directory, "absent.js")), {
    state: "missing",
  })
  const original = fs.lstat
  fs.lstat = async (path) => {
    if (path === entry)
      throw Object.assign(new Error("controlled permission denial"), {
        code: "EACCES",
      })
    return original(path)
  }
  syncBuiltinESMExports()
  try {
    const denied = await entryState(directory, entry)
    assert.equal(denied.state, "unavailable")
    assert.match(denied.reason, /EACCES/)
  } finally {
    fs.lstat = original
    syncBuiltinESMExports()
  }
  assert.deepEqual(await entryState(directory, entry), { state: "available" })
})

test("探测调用者取消不伪装成未安装，也不执行安装命令", async () => {
  const c = new AbortController()
  c.abort()
  let called = false
  const service = softwareService(() => {
    called = true
    throw new Error("must not execute")
  })
  await assert.rejects(service.detect(c.signal), { name: "AbortError" })
  assert.equal(called, false)
})

test("npm发现的权限拒绝不降级为未找到程序", async () => {
  const original = fs.access
  fs.access = async () => {
    throw Object.assign(new Error("EACCES: controlled path denial"), {
      code: "EACCES",
    })
  }
  syncBuiltinESMExports()
  try {
    const service = softwareService(() => {
      throw new Error("must not run")
    })
    const result = await service.detect(undefined, true)
    assert.equal(result.state, "unavailable")
    assert.match(result.issue, /EACCES/)
    assert.doesNotMatch(result.issue, /未找到npm/)
  } finally {
    fs.access = original
    syncBuiltinESMExports()
  }
})
