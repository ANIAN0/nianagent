import assert from "node:assert/strict"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import test from "node:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { activate } from "./host.mjs"
import http from "node:http"
import { randomBytes } from "node:crypto"
test("MCP 身份传输：会话隔离、并发配额、轮换撤销与现代协议", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-identity-transport-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const reservation = http.createServer()
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r))
  const port = reservation.address().port
  await new Promise((r) => reservation.close(r))
  const endpoint = `http://127.0.0.1:${port}/mcp`
  await writeFile(
    join(directory, "settings.json"),
    JSON.stringify({ revision: 0, port, selected: ["identity_probe"] })
  )
  const legacy = { token: randomBytes(32).toString("base64url") }
  await writeFile(join(directory, "token.json"), JSON.stringify(legacy))
  const calls = []
  let release
  let started
  const waiting = new Promise((r) => (started = r))
  const plugin = await activate({
    directory,
    isActive: () => true,
    logs: { append: async () => {} },
    sharedTools: {
      list: () => [
        {
          name: "identity_probe",
          plugin: "notes-workbench",
          generation: 1,
          description: "isolated acceptance consumer",
          inputSchema: { type: "object" },
        },
      ],
      subscribe: () => () => {},
      call: async (name, args, ctx) => {
        calls.push({
          actorId: ctx.actorId,
          credentialId: ctx.credentialId,
          args,
        })
        if (args.hold) {
          started()
          await new Promise((r) => (release = r))
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                actorId: ctx.actorId,
                credentialId: ctx.credentialId,
              }),
            },
          ],
        }
      },
    },
  })
  const op = async (name, input = {}) =>
    (
      await plugin.operations[name].execute(
        input,
        {},
        new AbortController().signal
      )
    ).value
  const A = await op("register", { displayName: "A" }),
    B = await op("register", { displayName: "B" })
  let id = 0
  async function req(credential, method, params = {}, sid, headers = {}) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer " + credential.token,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sid
          ? { "mcp-session-id": sid, "mcp-protocol-version": "2025-03-26" }
          : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(10000),
    })
    const text = await res.text()
    const line = text.split("\n").find((x) => x.startsWith("data: "))
    return {
      status: res.status,
      sid: res.headers.get("mcp-session-id"),
      data: text ? (line ? JSON.parse(line.slice(6)) : JSON.parse(text)) : null,
    }
  }
  async function init(c) {
    return req(c, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "acceptance", version: "1" },
    })
  }
  try {
    assert.equal((await req({ token: "invalid" }, "tools/list")).status, 401)
    const legacySession = await init(legacy)
    const denied = await req(
      legacy,
      "tools/call",
      {
        name: "identity_probe",
        arguments: {},
      },
      legacySession.sid
    )
    assert.equal(denied.data.result.isError, true)
    assert.match(denied.data.result.content[0].text, /identity_denied/)
    assert.equal(calls.length, 0)
    const saved = JSON.parse(
      await readFile(join(directory, "credentials.json"), "utf8")
    )
    await op("revoke", {
      credentialId: saved.credentials.find((c) => c.actorId === "legacy-shared")
        .credentialId,
    })
    const a = await init(A),
      b = await init(B)
    assert.equal(a.status, 200)
    assert.ok(a.sid)
    assert.equal(b.status, 200)
    const concurrent = await op("register", { displayName: "Concurrent" })
    const burst = await Promise.all(
      Array.from({ length: 12 }, () => init(concurrent))
    )
    assert.equal(burst.filter((r) => r.status === 200).length, 8)
    assert.equal(burst.filter((r) => r.status === 503).length, 4)
    await op("revoke", { credentialId: concurrent.credentialId })
    t.diagnostic("PASS simultaneous 12 initializes obey 8-session limit")
    assert.equal((await req(B, "tools/list", {}, a.sid)).status, 404)
    assert.equal((await req(A, "tools/list", {}, b.sid)).status, 404)
    t.diagnostic("PASS cross-credential sessions denied both ways")
    const ac = await req(
      A,
      "tools/call",
      { name: "identity_probe", arguments: {} },
      a.sid
    )
    assert.equal(ac.status, 200)
    assert.equal(calls.at(-1).actorId, A.actorId)
    for (let i = 1; i < 8; i++) assert.equal((await init(A)).status, 200)
    assert.equal((await init(A)).status, 503)
    t.diagnostic("PASS same credential 8 sessions; ninth denied")
    const rotated = await op("rotate", { actorId: A.actorId })
    assert.equal(rotated.actorId, A.actorId)
    assert.notEqual(rotated.credentialId, A.credentialId)
    assert.equal((await req(A, "tools/list", {}, a.sid)).status, 401)
    assert.equal((await req(rotated, "tools/list", {}, a.sid)).status, 404)
    const next = await init(rotated)
    assert.equal(next.status, 200)
    await req(
      rotated,
      "tools/call",
      { name: "identity_probe", arguments: {} },
      next.sid
    )
    assert.equal(calls.at(-1).actorId, A.actorId)
    t.diagnostic("PASS rotation stable actor, old token/session rejected")
    const hold = req(
      B,
      "tools/call",
      { name: "identity_probe", arguments: { hold: true } },
      b.sid
    ).catch((e) => ({ network: e.name }))
    await waiting
    await op("revoke", { credentialId: B.credentialId })
    const count = calls.length
    assert.equal(
      (
        await req(
          B,
          "tools/call",
          { name: "identity_probe", arguments: {} },
          b.sid
        )
      ).status,
      401
    )
    assert.equal(calls.length, count)
    release()
    await hold
    assert.equal(calls.length, count)
    t.diagnostic(
      "PASS accepted work once; revoked credential cannot accept new work"
    )
    const persisted = JSON.parse(
      await readFile(join(directory, "credentials.json"), "utf8")
    )
    assert.equal(
      persisted.credentials.find((c) => c.credentialId === B.credentialId)
        .revokedAt !== null,
      true
    )
    const oversized = "x".repeat(8 * 1024 * 1024 + 1)
    for (const chunked of [false, true]) {
      const response = await new Promise((resolve, reject) => {
        const r = http.request(
          endpoint,
          {
            method: "POST",
            headers: {
              authorization: "Bearer " + rotated.token,
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              ...(chunked
                ? {}
                : { "content-length": Buffer.byteLength(oversized) }),
            },
          },
          (res) => {
            let body = ""
            res.on("data", (c) => (body += c))
            res.on("end", () => resolve({ status: res.statusCode, body }))
          }
        )
        r.on("error", reject)
        r.end(oversized)
      })
      assert.equal(response.status, 413)
      assert.equal(JSON.parse(response.body).error.code, -32600)
    }
    t.diagnostic("PASS declared and chunked 8 MiB overflow: HTTP 413 JSON-RPC")
    const modernMeta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        name: "modern-test",
        version: "1",
      },
      "io.modelcontextprotocol/clientCapabilities": {},
    }
    const modern = await req(
      rotated,
      "tools/call",
      { name: "identity_probe", arguments: {}, _meta: modernMeta },
      undefined,
      {
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "identity_probe",
      }
    )
    assert.equal(modern.data.result.resultType, "complete")
    assert.equal(modern.status, 200)
    assert.equal(calls.at(-1).actorId, rotated.actorId)
    assert.equal(
      (
        await req(
          B,
          "tools/call",
          { name: "identity_probe", arguments: {}, _meta: modernMeta },
          undefined,
          {
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "tools/call",
            "mcp-name": "identity_probe",
          }
        )
      ).status,
      401
    )
    for (let i = 1; i < 8; i++) assert.equal((await init(rotated)).status, 200)
    for (let agent = 0; agent < 7; agent++) {
      const c = await op("register", { displayName: "Quota " + agent })
      for (let i = 0; i < 8; i++) assert.equal((await init(c)).status, 200)
    }
    const extra = await op("register", { displayName: "Overflow" })
    assert.equal((await init(extra)).status, 503)
    t.diagnostic("PASS global 64 session budget, 65th rejected")
  } finally {
    release?.()
    await plugin.close()
  }
})
