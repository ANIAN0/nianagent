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
  rename,
  symlink,
} from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { MaterialService } from "../materials.mjs"
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==",
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

test("workspace previews resolve relative links and reject outside and junction targets while explicit selected files remain usable", async () => {
  const f = await fixture()
  try {
    const outside = join(f.directory, "外部")
    await mkdir(outside)
    const source = join(outside, "private.md")
    await writeFile(source, "OUTSIDE_MUST_NOT_BE_READ_FROM_AGENT_LINK")
    await writeFile(join(f.cwd, "generated.md"), "GENERATED_INSIDE")
    const [relative] = await f.service.prepare("session", f.cwd, ["generated.md"], "workspace")
    assert.equal(relative.status, "ready")
    assert.equal((await f.service.preview(f.cwd, relative.id)).content, "GENERATED_INSIDE")
    const [traversal] = await f.service.prepare("session", f.cwd, ["../外部/private.md"], "workspace")
    assert.equal(traversal.status, "failed")
    assert.equal(traversal.retryable, false)
    const [blocked] = await f.service.prepare("session", f.cwd, [source], "workspace")
    assert.equal(blocked.status, "failed")
    assert.equal(blocked.retryable, false)
    const [selected] = await f.service.prepare("session", f.cwd, [source])
    assert.equal(selected.status, "ready")
    assert.equal((await f.service.preview(f.cwd, selected.id)).content, "OUTSIDE_MUST_NOT_BE_READ_FROM_AGENT_LINK")
    const link = join(f.cwd, "linked-outside")
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir")
    const [viaLink] = await f.service.prepare("session", f.cwd, [join(link, "private.md")], "workspace")
    assert.equal(viaLink.status, "failed")
    assert.equal(viaLink.retryable, false)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test("path searches normalize slashes without changing canonical material identity", async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.cwd, "src"))
    await writeFile(join(f.cwd, "src", "App.tsx"), "SOURCE")
    const slash = await f.service.catalog("session", f.cwd, "src/App")
    const backslash = await f.service.catalog("session", f.cwd, "SRC\\APP")
    assert.equal(slash.files.length, 1)
    assert.deepEqual(slash.files, backslash.files)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test("official output images reuse fixed material cache and survive cwd removal without base64 snapshots", async () => {
  const f = await fixture()
  try {
    const reference = await f.service.captureImage(f.cwd, "Pi-read", "image/png", image.toString("base64"))
    assert.equal(reference.status, "ready", reference.error)
    assert.equal(reference.type, "image")
    assert.equal(Object.hasOwn(reference, "data"), false)
    const first = await readFile(join(f.service.directory, `${reference.id}.json`))
    await rm(f.cwd, { recursive: true })
    const restarted = new MaterialService(join(f.directory, "data"), f.sessions)
    const recovered = await restarted.captureImage(f.cwd, "Pi-read", "image/png", image.toString("base64"))
    assert.deepEqual(recovered, reference)
    assert.deepEqual(await readFile(join(f.service.directory, `${reference.id}.json`)), first)
    assert.equal((await restarted.preview(f.cwd, reference.id)).data, image.toString("base64"))
    const invalid = await restarted.captureImage(f.cwd, "Pi-invalid", "image/png", "invalid!")
    assert.equal(invalid.status, "failed")
    assert.equal(invalid.retryable, false)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})
test("prepared images remain fixed after source edits, restart and workspace removal", async () => {
  const f = await fixture()
  try {
    const source = join(f.cwd, "示例 图.png")
    await writeFile(source, image)
    const [material] = await f.service.prepare("session", f.cwd, [source])
    assert.equal(material.status, "ready", material.error)
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
    const nativePath = await realpath(source)
    const promptPath =
      process.platform === "win32"
        ? nativePath.replaceAll("\\", "/")
        : nativePath
    assert.ok(
      prompt.textPrefix.startsWith(
        `Referenced files (not read):\n@${JSON.stringify(promptPath)}\n`
      )
    )
    assert.ok(prompt.textPrefix.includes("exact path inside the quotes"))
    assert.equal(prompt.textPrefix.includes("current内容"), false)
    await rm(source)
    const [restored] = await f.service.restore("session", f.cwd, [material])
    assert.equal(restored.id, material.id)
    assert.equal(restored.name, material.name)
    assert.equal(restored.status, "failed")
    assert.equal(restored.retryable, true)
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
test("mixed file and Skill references preserve exact absolute paths and separate resource scopes", async () => {
  const f = await fixture()
  try {
    const fileDirectory = join(f.cwd, "含 空格")
    await mkdir(fileDirectory)
    const localFile = join(fileDirectory, "引用材料.txt")
    const externalFile = join(f.directory, "工作区外 文件.txt")
    await writeFile(localFile, "LOCAL_FILE_ONLY")
    await writeFile(externalFile, "EXTERNAL_FILE_ONLY")
    const base = join(f.cwd, ".agents", "skills", "report")
    await mkdir(base, { recursive: true })
    const skillFile = join(base, "SKILL.md")
    await writeFile(
      skillFile,
      "---\nname: report\ndescription: Report\n---\nRead references/check.md only for Skill resources. Report SKILL_FIXED."
    )
    f.resources.skills.push({
      name: "report",
      description: "Report",
      filePath: await realpath(skillFile),
      baseDir: base,
    })
    const [skill, local, external] = await f.service.prepare("session", f.cwd, [
      skillFile,
      localFile,
      externalFile,
    ])
    assert.ok([skill, local, external].every((item) => item.status === "ready"))
    const prompt = await f.service.resolveForPrompt({
      sessionId: "session",
      cwd: f.cwd,
      text: "按本次引用的真实文件和 Skill 完成任务。",
      materials: [skill, local, external, local],
      model: { input: ["text"] },
    })
    const paths = Array.from(
      prompt.textPrefix.matchAll(/^@("(?:\\.|[^"\\\r\n])*")$/gm),
      (match) => JSON.parse(match[1])
    )
    const sources = [await realpath(localFile), await realpath(externalFile)]
    assert.deepEqual(
      paths,
      sources.map((path) =>
        process.platform === "win32" ? path.replaceAll("\\", "/") : path
      )
    )
    assert.deepEqual(
      await Promise.all(paths.map((path) => readFile(path, "utf8"))),
      ["LOCAL_FILE_ONLY", "EXTERNAL_FILE_ONLY"]
    )
    assert.equal(
      prompt.textPrefix.match(/Referenced files \(not read\):/g).length,
      1
    )
    assert.equal(prompt.textPrefix.includes("LOCAL_FILE_ONLY"), false)
    assert.equal(prompt.textPrefix.includes("EXTERNAL_FILE_ONLY"), false)
    assert.equal(prompt.textPrefix.match(/SKILL_FIXED/g).length, 1)
    assert.ok(prompt.textPrefix.includes(`References are relative to ${base}.`))
    assert.ok(
      prompt.textPrefix.includes("only to relative resources inside that Skill")
    )
    assert.ok(prompt.textPrefix.includes("Do not guess substitute filenames"))
    assert.ok(
      prompt.textPrefix.indexOf("<skill ") >
        prompt.textPrefix.indexOf(`@${JSON.stringify(paths[1])}`)
    )
    assert.deepEqual(
      prompt.displayMaterials.map((item) => item.source),
      [await realpath(skillFile), ...sources]
    )
    assert.equal(prompt.text, "按本次引用的真实文件和 Skill 完成任务。")
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
    assert.equal(invalid.retryable, true)
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
      (error) =>
        /类型与实际内容/.test(error.message) &&
        error.issue?.code === "material_invalid" &&
        error.issue.recovery === "none"
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
    assert.equal(invalid.retryable, false)
    assert.match(invalid.error, /8MiB/)
    assert.equal((await readFile(source)).length, 8 * 1024 * 1024 + 1)
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test("damaged fixed images return an authority non-retryable result regardless of caller metadata", async () => {
  const f = await fixture()
  try {
    const material = await f.service.upload(
      "session",
      f.cwd,
      "截图.png",
      "image/png",
      image.toString("base64")
    )
    const file = join(f.service.directory, `${material.id}.json`)
    const record = JSON.parse(await readFile(file, "utf8"))
    record.data = Buffer.from("invalid immutable bytes").toString("base64")
    await writeFile(file, JSON.stringify(record))
    const [failed] = await f.service.restore("session", f.cwd, [
      { ...material, retryable: true },
    ])
    assert.equal(failed.id, material.id)
    assert.equal(failed.status, "failed")
    assert.equal(failed.retryable, false)
    assert.match(failed.error, /图片内容损坏/)
    // A valid signature with mutated/truncated fixed content must also fail.
    record.data = image.subarray(0, 12).toString("base64")
    await writeFile(file, JSON.stringify(record))
    assert.equal(
      (await f.service.restore("session", f.cwd, [material]))[0].retryable,
      false
    )
    await writeFile(file, "invalid-json")
    assert.equal(
      (await f.service.restore("session", f.cwd, [material]))[0].retryable,
      false
    )
    const reselected = await f.service.upload(
      "session",
      f.cwd,
      material.name,
      "image/png",
      image.toString("base64")
    )
    assert.equal(reselected.id, material.id)
    assert.equal(
      (await f.service.restore("session", f.cwd, [failed]))[0].status,
      "ready"
    )
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test("temporary cache read failures remain retryable and restore the same fixed image after recovery", async () => {
  const f = await fixture()
  try {
    const material = await f.service.upload(
      "session",
      f.cwd,
      "截图.png",
      "image/png",
      image.toString("base64")
    )
    const file = join(f.service.directory, `${material.id}.json`)
    const retained = join(f.service.directory, `${material.id}.retained`)
    await rename(file, retained)
    await mkdir(file)
    const [failed] = await f.service.restore("session", f.cwd, [
      { ...material, retryable: false },
    ])
    assert.equal(failed.id, material.id)
    assert.equal(failed.status, "failed")
    assert.equal(failed.retryable, true)
    await rm(file, { recursive: true })
    await rename(retained, file)
    const [restored] = await f.service.restore("session", f.cwd, [failed])
    assert.equal(restored.id, material.id)
    assert.equal(restored.status, "ready")
    assert.equal(
      (await f.service.preview(f.cwd, material.id)).data,
      image.toString("base64")
    )
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test("an initial path preparation failure survives persisted restore until an explicit retry installs it", async () => {
  const f = await fixture()
  try {
    const source = join(f.cwd, "待引用 文件.md")
    await writeFile(source, "文件仍可重新选择和准备。")
    // A real filesystem obstacle prevents the initial metadata write.
    await mkdir(dirname(f.service.directory), { recursive: true })
    await writeFile(
      f.service.directory,
      "temporarily blocks the storage directory"
    )
    const [failed] = await f.service.prepare("session", f.cwd, [source])
    assert.equal(failed.type, "file")
    assert.equal(failed.status, "failed")
    assert.equal(failed.retryable, true)
    const draft = join(f.directory, "persisted-material.json")
    await writeFile(draft, JSON.stringify(failed))
    await rm(f.service.directory)
    // The source may also be temporarily unavailable when the draft is opened.
    // Restore must preserve the failed selection without reading or preparing it.
    const retained = join(f.cwd, "待引用 文件.retained")
    await rename(source, retained)
    const restarted = new MaterialService(join(f.directory, "data"), f.sessions)
    const persisted = JSON.parse(await readFile(draft, "utf8"))
    const [restored] = await restarted.restore("session", f.cwd, [persisted])
    assert.equal(restored.id, failed.id)
    assert.equal(restored.source, source)
    assert.equal(restored.status, "failed")
    assert.equal(restored.retryable, true)
    // The composer persists a temporary preparing presentation while checking
    // drafts. Closing then reopening during that check must retain recovery too.
    const [reopenedDuringCheck] = await restarted.restore("session", f.cwd, [
      { ...persisted, status: "preparing" },
    ])
    assert.equal(reopenedDuringCheck.id, failed.id)
    assert.equal(reopenedDuringCheck.status, "failed")
    assert.equal(reopenedDuringCheck.retryable, true)
    await assert.rejects(stat(restarted.directory), { code: "ENOENT" })
    await rename(retained, source)
    // This is the formal path preparation called by the user's manual retry.
    const [prepared] = await restarted.prepare("session", f.cwd, [
      restored.source,
    ])
    assert.equal(prepared.status, "ready", prepared.error)
    assert.notEqual(prepared.id, failed.id)
    assert.equal(prepared.source, await realpath(source))
    assert.equal(
      (await restarted.restore("session", f.cwd, [prepared]))[0].status,
      "ready"
    )
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test("provisional path recovery cannot rescue changed identities or missing fixed records", async () => {
  const f = await fixture()
  try {
    const source = join(f.cwd, "source.md")
    await writeFile(source, "real source")
    await mkdir(dirname(f.service.directory), { recursive: true })
    await writeFile(f.service.directory, "blocked")
    const [failed] = await f.service.prepare("session", f.cwd, [source])
    await rm(f.service.directory)
    const variants = [
      { ...failed, id: "f".repeat(64) },
      { ...failed, source: join(f.cwd, "another.md") },
      { ...failed, source: "relative.md" },
      { ...failed, type: "image" },
      { ...failed, status: "ready" },
      { ...failed, retryable: false },
    ]
    for (const value of await f.service.restore("session", f.cwd, variants)) {
      assert.equal(value.status, "failed")
      assert.equal(value.retryable, false)
    }
    const otherCwd = join(f.cwd, "another-workspace")
    await mkdir(otherCwd)
    assert.equal(
      (await f.service.restore("session", otherCwd, [failed]))[0].retryable,
      false
    )
    await assert.rejects(stat(f.service.directory), { code: "ENOENT" })

    const [fixedFile] = await f.service.prepare("session", f.cwd, [source])
    await rm(join(f.service.directory, `${fixedFile.id}.json`))
    assert.equal(
      (
        await f.service.restore("session", f.cwd, [
          { ...fixedFile, status: "failed", retryable: true },
        ])
      )[0].retryable,
      false
    )

    const imageSource = join(f.cwd, "fixed.png")
    await writeFile(imageSource, image)
    const [fixedImage] = await f.service.prepare("session", f.cwd, [
      imageSource,
    ])
    const fixedRecord = join(f.service.directory, `${fixedImage.id}.json`)
    await rm(fixedRecord)
    const [missing] = await f.service.restore("session", f.cwd, [
      { ...fixedImage, status: "failed", retryable: true },
    ])
    assert.equal(missing.status, "failed")
    assert.equal(missing.retryable, false)
    // The valid image source is available, but automatic restore must not fix
    // a lost fixed image by silently preparing that source again.
    await assert.rejects(stat(fixedRecord), { code: "ENOENT" })
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})
