import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  stat,
  readdir,
} from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { MaterialService } from "../materials.mjs"
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aotkAAAAASUVORK5CYII=",
  "base64"
)
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "moon-materials-"))
  const cwd = join(directory, "工作区")
  await mkdir(cwd)
  const resources = { skills: [], diagnostics: [] }
  const sessions = {
    identity: () => {},
    cwd: async (value) => {
      const path = await realpath(value)
      assert.equal((await stat(path)).isDirectory(), true)
      return path
    },
    skillResources: async () => resources,
  }
  return {
    directory,
    cwd: await realpath(cwd),
    resources,
    sessions,
    service: new MaterialService(join(directory, "data"), sessions),
  }
}
test("prepared images remain fixed after source edits, restart and workspace removal", async () => {
  const f = await fixture()
  try {
    const source = join(f.cwd, "示例 图.png")
    await writeFile(source, image)
    const [material] = await f.service.prepare("session", f.cwd, [source])
    assert.equal(material.type, "image")
    await writeFile(source, "changed")
    const prompt = await f.service.resolveForPrompt({
      sessionId: "session",
      cwd: f.cwd,
      materials: [material],
      model: { input: ["text", "image"] },
    })
    assert.deepEqual(prompt.images, [
      { type: "image", mimeType: "image/png", data: image.toString("base64") },
    ])
    await assert.rejects(
      f.service.resolveForPrompt({
        sessionId: "session",
        cwd: f.cwd,
        materials: [material],
        model: { input: ["text"] },
      }),
      /不支持图片/
    )
    const restarted = new MaterialService(join(f.directory, "data"), f.sessions)
    assert.equal(
      (await restarted.restore("session", f.cwd, [material]))[0].status,
      "ready"
    )
    await rm(f.cwd, { recursive: true })
    const preview = await restarted.preview(f.cwd, material.id)
    assert.equal(preview.data, image.toString("base64"))
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})
test("file references deliver a readable native path and failures retain identity", async () => {
  const f = await fixture()
  try {
    const source = join(f.cwd, "参考 文件.md")
    await writeFile(source, "current内容")
    const catalog = await f.service.catalog("session", f.cwd, "参考")
    assert.equal(catalog.files.length, 1)
    const [material] = await f.service.prepare("session", f.cwd, [
      catalog.files[0].source,
    ])
    const prompt = await f.service.resolveForPrompt({
      sessionId: "session",
      cwd: f.cwd,
      materials: [material],
      model: { input: ["text"] },
    })
    assert.match(prompt.textPrefix, /参考 文件\.md/)
    assert.equal(prompt.textPrefix.includes("current内容"), false)
    await rm(source)
    const [restored] = await f.service.restore("session", f.cwd, [material])
    assert.equal(restored.id, material.id)
    assert.equal(restored.name, material.name)
    assert.equal(restored.status, "failed")
    await assert.rejects(
      f.service.resolveForPrompt({
        sessionId: "session",
        cwd: f.cwd,
        materials: [material],
        model: { input: ["text"] },
      }),
      /来源已不存在/
    )
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})
test("explicit skills keep prepared instructions, source and relative resource base", async () => {
  const f = await fixture()
  try {
    const base = join(f.cwd, ".agents", "skills", "review")
    await mkdir(base, { recursive: true })
    const source = join(base, "SKILL.md")
    await writeFile(
      source,
      "---\nname: review\ndescription: Review\n---\nRead references/check.md and report REVIEW_OK."
    )
    f.resources.skills.push({
      name: "review",
      description: "Review",
      filePath: await realpath(source),
      baseDir: base,
    })
    const [material] = await f.service.prepare("session", f.cwd, [source])
    assert.equal(material.type, "skill")
    const prompt = await f.service.resolveForPrompt({
      sessionId: "session",
      cwd: f.cwd,
      materials: [material, material],
      model: { input: ["text"] },
    })
    assert.equal(prompt.displayMaterials.length, 1)
    assert.equal(prompt.textPrefix.match(/REVIEW_OK/g).length, 1)
    assert.ok(prompt.textPrefix.includes(base))
    assert.equal(prompt.textPrefix.includes("name: review"), false)
    const command = await f.service.resolveForPrompt({
      sessionId: "session",
      cwd: f.cwd,
      text: "/skill:review inspect this",
      materials: [material],
      model: { input: ["text"] },
    })
    assert.equal(command.text, "inspect this")
    assert.equal(command.displayMaterials.length, 1)
    assert.equal(command.textPrefix.match(/REVIEW_OK/g).length, 1)
    await writeFile(source, "changed")
    assert.match(
      (await f.service.preview(f.cwd, material.id)).content,
      /REVIEW_OK/
    )
    f.resources.diagnostics.push({
      type: "collision",
      message: "same name",
      collision: { name: "review" },
    })
    const [invalid] = await f.service.restore("session", f.cwd, [material])
    assert.equal(invalid.status, "failed")
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})
test("cancelled preparation installs no metadata and oversized or disguised images fail", async () => {
  const f = await fixture()
  try {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      f.service.upload(
        "session",
        f.cwd,
        "image.png",
        "image/png",
        image.toString("base64"),
        controller.signal
      )
    )
    assert.deepEqual(await readdir(f.service.directory).catch(() => []), [])
    await assert.rejects(
      f.service.upload(
        "session",
        f.cwd,
        "image.png",
        "image/jpeg",
        image.toString("base64")
      ),
      /类型与实际内容/
    )
    await assert.rejects(
      f.service.upload(
        "session",
        f.cwd,
        "broken.png",
        "image/png",
        image.subarray(0, 12).toString("base64")
      ),
      /无法解码/
    )
    const source = join(f.cwd, "large.png")
    await writeFile(source, Buffer.alloc(8 * 1024 * 1024 + 1))
    const [invalid] = await f.service.prepare("session", f.cwd, [source])
    assert.equal(invalid.status, "failed")
    assert.match(invalid.error, /8MiB/)
    assert.equal((await readFile(source)).length, 8 * 1024 * 1024 + 1)
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})
