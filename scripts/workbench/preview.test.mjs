import test from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import { syncBuiltinESMExports } from "node:module"
import {
  PreviewSessions,
  isPreviewHost,
  previewHeaders,
  MAX_SESSIONS,
} from "../../apps/workbench/src/server/notes/preview.mjs"

test("闲置过期在读取时拒绝，不因读取复活", (t) => {
  let now = 1000
  t.mock.method(Date, "now", () => now)
  const sessions = new PreviewSessions()
  const sid = sessions.open("v1")
  now += 30 * 60000 + 1
  assert.equal(sessions.resolve(sid), null)
  assert.equal(sessions.map.has(sid), false)
})

test("随机sid碰撞不能覆盖其他版本的活跃会话", (t) => {
  const values = ["aabbcc00", "aabbcc00", "ddeeff00"]
  t.mock.method(crypto, "randomBytes", () =>
    Buffer.from((values.shift() ?? "aabbcc00").repeat(4), "hex")
  )
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  })
  const sessions = new PreviewSessions()
  const first = sessions.open("v1")
  const second = sessions.open("v2")
  assert.notEqual(first, second)
  assert.equal(sessions.resolve(first).versionId, "v1")
  assert.equal(sessions.resolve(second).versionId, "v2")
  assert.throws(() => sessions.open("v3"), { code: "internal_error" })
  assert.equal(sessions.map.size, 2)
})

test("会话容量、释放归属及过期回收", (t) => {
  let now = 1000
  t.mock.method(Date, "now", () => now)
  const sessions = new PreviewSessions()
  const ids = Array.from({ length: MAX_SESSIONS }, (_, i) =>
    sessions.open(`v${i}`)
  )
  assert.throws(() => sessions.open("overflow"), { code: "limit_exceeded" })
  assert.equal(sessions.release(ids[0], "wrong"), false)
  assert.equal(sessions.release(ids[0], "v0"), true)
  assert.equal(sessions.release(ids[0], "v0"), false)
  sessions.open("replacement")
  now += 30 * 60000 + 1
  assert.ok(sessions.open("fresh"))
  assert.equal(sessions.map.size, 1)
})

test("预览Host只接受当前端口单层sid子域，CSP隔离危险能力", () => {
  const sid = "aabbcc00".repeat(4)
  assert.equal(isPreviewHost(`${sid}.localhost:29830`, 29830), sid)
  for (const host of [
    "127.0.0.1:29830",
    "localhost:29830",
    `${sid}.localhost:29831`,
    "aabbcc.localhost:29830",
    "aabbcc.evil.localhost:29830",
    "aabbcc.localhost.evil:29830",
    "aabbcc.localhost:29830,evil",
  ]) {
    assert.equal(isPreviewHost(host, 29830), null)
  }
  const headers = previewHeaders(29830)
  for (const rule of [
    "worker-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
  ]) {
    assert.ok(headers["content-security-policy"].includes(rule))
  }
  assert.equal(headers["x-content-type-options"], "nosniff")
})
