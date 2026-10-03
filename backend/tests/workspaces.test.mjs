import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { WorkspaceService } from "../workspaces.mjs"
import {
  connectDirectoryHost,
  acceptDirectoryReply,
  closeDirectoryHost,
  pickNativeDirectory,
} from "../native-directory.mjs"

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "moon-workspaces-"))
  const cwd = join(root, "project")
  const other = join(root, "other")
  const data = join(root, "data")
  await mkdir(cwd)
  await mkdir(other)
  const service = new WorkspaceService(data, { cwd, ...options })
  t.after(async () => {
    service.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, cwd, other, data, service }
}

test("workspace registry imports actual cwd once and restores selected directory", async (t) => {
  const { service, cwd, other, data } = await fixture(t)
  const initial = await service.list()
  assert.equal(initial.items.length, 1)
  assert.equal(initial.items[0].path.toLowerCase(), cwd.toLowerCase())
  assert.equal(initial.selectedId, initial.items[0].id)
  const added = await service.add(other)
  const restored = new WorkspaceService(data, {
    cwd: "must-not-be-imported-again",
  })
  t.after(() => restored.close())
  const list = await restored.list()
  assert.equal(list.items.length, 2)
  assert.equal(list.selectedId, added.id)
  assert.equal((await restored.get(added.id)).path, added.path)
  assert.equal(await restored.get("missing"), null)
  await restored.select(initial.selectedId)
  assert.equal((await service.list()).selectedId, initial.selectedId)
})

test("workspace identity deduplicates canonical aliases and Windows case", async (t) => {
  const { service, root, cwd } = await fixture(t)
  const first = await service.add(cwd)
  const alias = join(root, "alias")
  await symlink(cwd, alias, process.platform === "win32" ? "junction" : "dir")
  assert.equal((await service.add(alias)).id, first.id)
  assert.equal((await service.add(join(cwd, "."))).id, first.id)
  if (process.platform === "win32")
    assert.equal((await service.add(cwd.toUpperCase())).id, first.id)
  assert.equal((await service.list()).items.length, 1)
})

test("missing workspace stays visible and cannot be selected; arbitrary files are rejected", async (t) => {
  const { service, other } = await fixture(t)
  const added = await service.add(other)
  await rm(other, { recursive: true })
  const snapshot = await service.list()
  assert.equal(snapshot.selectedId, added.id)
  assert.equal(
    snapshot.items.find((item) => item.id === added.id).available,
    false
  )
  await assert.rejects(service.select(added.id), /工作目录不存在/)
  await assert.rejects(service.add("relative/path"), /绝对目录/)
  await assert.rejects(service.add(service.file), /工作目录不存在/)
})

test("cancel while waiting for the workspace data lock performs no write", async (t) => {
  const { service, other, data } = await fixture(t)
  await service.list()
  const before = await readFile(service.file, "utf8")
  const release = await lockfile.lock(service.file, {
    realpath: false,
    lockfilePath: `${service.file}.lock`,
  })
  const controller = new AbortController()
  const pending = service.add(other, controller.signal)
  const rejected = assert.rejects(pending, /cancelled-by-test/)
  await new Promise((resolve) => setTimeout(resolve, 50))
  controller.abort(new Error("cancelled-by-test"))
  await release()
  await rejected
  assert.equal(await readFile(service.file, "utf8"), before)
  assert.ok((await readdir(data)).every((name) => !name.endsWith(".tmp")))
})

test("system chooser cancel and cancelled late result never register a directory", async (t) => {
  let reply
  const { service, other } = await fixture(t, {
    pickDirectory: () =>
      new Promise((resolve) => {
        reply = resolve
      }),
  })
  await service.list()
  const before = await readFile(service.file, "utf8")
  const first = service.choose()
  await assert.rejects(service.choose(), /已有目录选择窗口/)
  reply(null)
  assert.equal(await first, null)
  assert.equal(await readFile(service.file, "utf8"), before)
  const controller = new AbortController()
  const second = service.choose(controller.signal)
  controller.abort(new Error("late-cancel"))
  reply(other)
  await assert.rejects(second, /late-cancel/)
  assert.equal(await readFile(service.file, "utf8"), before)
})

test("corrupt workspace data is reported and preserved", async (t) => {
  const { service, data, other } = await fixture(t)
  await mkdir(data)
  await writeFile(service.file, "{invalid-json")
  await assert.rejects(service.list(), /工作区文件损坏/)
  await assert.rejects(service.add(other), /工作区文件损坏/)
  assert.equal(await readFile(service.file, "utf8"), "{invalid-json")
})

test("concurrent adds keep both directories and close is terminal", async (t) => {
  const { service, cwd, other } = await fixture(t)
  await Promise.all([service.add(cwd), service.add(other)])
  assert.equal((await service.list()).items.length, 2)
  service.close()
  await assert.rejects(service.add(cwd), /已关闭/)
})

test("host capability accepts matching replies only and discards a cancelled result", async (t) => {
  let sent
  connectDirectoryHost((message) => {
    sent = message
  })
  t.after(closeDirectoryHost)
  const controller = new AbortController()
  const first = pickNativeDirectory(controller.signal)
  assert.equal(sent.capability, "pickDirectory")
  assert.equal(acceptDirectoryReply({ operation: "another" }), false)
  const staleId = sent.id
  controller.abort(new Error("host-cancel"))
  await assert.rejects(first, /host-cancel/)
  assert.equal(
    acceptDirectoryReply({
      operation: "$hostReply",
      id: staleId,
      result: "H:/late",
    }),
    true
  )
  const second = pickNativeDirectory()
  acceptDirectoryReply({ operation: "$hostReply", id: sent.id, result: null })
  assert.equal(await second, null)
})
