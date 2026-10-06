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
  lstat,
} from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { MaterialService } from "../materials.mjs"
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==",
  "base64"
)
const fixtureRoot = resolve(".dev/task-orchestrator/attachment-check-temp/backend")
async function fixture() {
  await mkdir(fixtureRoot, { recursive: true })
  for (const path of [resolve(".dev"), resolve(".dev/task-orchestrator"), dirname(fixtureRoot), fixtureRoot])
    assert.equal((await lstat(path)).isSymbolicLink(), false)
  const directory = await mkdtemp(join(fixtureRoot, "moon-materials-"))
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

async function cleanupFixture(directory) {
  assert.equal(dirname(resolve(directory)), fixtureRoot)
  assert.ok(basename(directory).startsWith("moon-materials-"))
  for (const path of [resolve(".dev"), resolve(".dev/task-orchestrator"), dirname(fixtureRoot), fixtureRoot, directory])
    assert.equal((await lstat(path)).isSymbolicLink(), false)
  await rm(directory, { recursive: true, force: true })
}

test("directory catalog, drill, prepare, restart, preview and prompt preserve one bounded reference", async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.cwd, "docs", "nested"), { recursive: true })
    await writeFile(join(f.cwd, "docs", "guide.md"), "PRIVATE_CONTENT_NOT_IN_PROMPT")
    await writeFile(join(f.cwd, "docs", "nested", "child.md"), "NESTED_CONTENT")
    const root = await f.service.catalog("session", f.cwd, "docs")
    const folder = root.files.find(item => item.type === "directory" && item.name === "docs")
    assert.ok(folder)
    const children = await f.service.catalog("session", f.cwd, "docs/")
    assert.deepEqual(children.files.map(item => item.name).sort(), ["guide.md", "nested"])
    const [prepared] = await f.service.prepare("session", f.cwd, [folder.source], "workspace")
    assert.equal(prepared.type, "directory")
    assert.equal(prepared.id, folder.id)
    const restarted = new MaterialService(join(f.directory, "data"), f.sessions)
    assert.deepEqual(await restarted.restore("session", f.cwd, [prepared]), [prepared])
    const preview = await restarted.preview(f.cwd, prepared.id)
    assert.equal(preview.label, "当前目录")
    assert.match(preview.content, /nested\//u)
    assert.doesNotMatch(preview.content, /PRIVATE_CONTENT/u)
    const prompt = await restarted.resolveForPrompt({ sessionId: "session", cwd: f.cwd, materials: [prepared], text: "检查 @docs" })
    assert.match(prompt.textPrefix, /Directory: @/u)
    assert.doesNotMatch(prompt.textPrefix, /PRIVATE_CONTENT|NESTED_CONTENT/u)
    await rename(join(f.cwd, "docs"), join(f.cwd, "moved"))
    const [missing] = await restarted.restore("session", f.cwd, [prepared])
    assert.equal(missing.status, "failed")
  } finally { await cleanupFixture(f.directory) }
})

test("directory references and drill reject outside workspace and junction targets", async () => {
  const f = await fixture()
  try {
    const outside = join(f.directory, "outside")
    await mkdir(outside)
    await symlink(outside, join(f.cwd, "linked"), process.platform === "win32" ? "junction" : "dir")
    const [selected] = await f.service.prepare("session", f.cwd, [outside])
    assert.equal(selected.status, "failed")
    assert.equal(selected.type, "directory")
    assert.equal(selected.retryable, false)
    await assert.rejects(f.service.catalog("session", f.cwd, "linked/"), /工作区/u)
    await assert.rejects(f.service.catalog("session", f.cwd, "../outside/"), /工作区/u)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(f.service.prepare("session", f.cwd, [f.cwd], "workspace", controller.signal), { name: "AbortError" })
  } finally { await cleanupFixture(f.directory) }
})

test("failed preparation retains a stat-confirmed directory kind without guessing missing sources", async () => {
  const f = await fixture()
  try {
    const folder = join(f.cwd, "docs")
    await mkdir(folder)
    await mkdir(dirname(f.service.directory), { recursive: true })
    await writeFile(f.service.directory, "BLOCK_MATERIAL_STORE")
    const [failed] = await f.service.prepare("session", f.cwd, [folder])
    assert.equal(failed.status, "failed")
    assert.equal(failed.type, "directory")
    assert.equal(failed.source, folder)
    assert.equal(failed.retryable, true)
    const [restored] = await f.service.restore("session", f.cwd, [failed])
    assert.deepEqual(restored, failed)
    assert.match(restored.error, /目录/u)
    const [missing] = await f.service.prepare("session", f.cwd, [
      join(f.cwd, "missing-directory"),
    ])
    assert.equal(missing.status, "failed")
    assert.equal(missing.type, "file")
    assert.equal(missing.retryable, true)
    await rm(f.service.directory)
    const [prepared] = await f.service.prepare("session", f.cwd, [folder])
    assert.equal(prepared.status, "ready")
    assert.equal(prepared.type, "directory")
    assert.equal(prepared.source, await realpath(folder))
    const [unknown] = await f.service.restore("session", f.cwd, [
      { ...prepared, id: "0".repeat(64), status: "failed" },
    ])
    assert.equal(unknown.status, "failed")
    assert.equal(unknown.type, "directory")
    assert.equal(unknown.source, prepared.source)
    assert.equal(unknown.retryable, false)
  } finally {
    await cleanupFixture(f.directory)
  }
})

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
  } finally { await cleanupFixture(f.directory) }
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
  } finally { await cleanupFixture(f.directory) }
})

test("catalog ranks names before path matches and applies its limit after ranking", async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.cwd, "a-README.md-path"))
    for (let index = 0; index < 70; index++)
      await writeFile(
        join(
          f.cwd,
          "a-README.md-path",
          `${String(index).padStart(2, "0")}.txt`
        ),
        "PATH_MATCH"
      )
    await mkdir(join(f.cwd, "z-last"))
    await writeFile(join(f.cwd, "z-last", "README.md"), "EXACT_NAME")
    await writeFile(join(f.cwd, "README.md.backup"), "PREFIX_NAME")
    await writeFile(join(f.cwd, "copy-README.md.txt"), "CONTAINS_NAME")
    const result = await f.service.catalog("session", f.cwd, "README.md")
    assert.equal(result.files.length, 60)
    assert.deepEqual(
      result.files.slice(0, 4).map((item) => item.name),
      [
        "README.md",
        "README.md.backup",
        "a-README.md-path",
        "copy-README.md.txt",
      ]
    )
    assert.equal(
      result.files[0].source,
      await realpath(join(f.cwd, "z-last", "README.md"))
    )
    assert.ok(
      result.diagnostics.some(
        (item) => item.scope === "files" && /数量限制/u.test(item.message)
      )
    )
    assert.deepEqual(
      (await f.service.catalog("session", f.cwd, "README.md")).files,
      result.files
    )
  } finally {
    await cleanupFixture(f.directory)
  }
})

test("empty and slash catalogs keep directories first while path searches retain exact sources", async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.cwd, "docs folder", "z-dir"), { recursive: true })
    await mkdir(join(f.cwd, "docs folder", "a-dir"))
    await writeFile(join(f.cwd, "docs folder", "b.md"), "B")
    await writeFile(join(f.cwd, "docs folder", "a.md"), "A")
    await writeFile(join(f.cwd, "0-root.md"), "ROOT")
    const empty = await f.service.catalog("session", f.cwd)
    assert.equal(empty.files[0].type, "directory")
    const children = await f.service.catalog("session", f.cwd, "docs folder/")
    assert.deepEqual(
      children.files.map((item) => item.name),
      ["a-dir", "z-dir", "a.md", "b.md"]
    )
    const path = await f.service.catalog("session", f.cwd, "DOCS FOLDER\\A.MD")
    assert.equal(path.files.length, 1)
    assert.equal(
      path.files[0].source,
      await realpath(join(f.cwd, "docs folder", "a.md"))
    )
  } finally {
    await cleanupFixture(f.directory)
  }
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
  } finally { await cleanupFixture(f.directory) }
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
    await cleanupFixture(f.directory)
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
    await cleanupFixture(f.directory)
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
    await cleanupFixture(f.directory)
  }
})

test("native idle material resolution preserves raw Skill text and does not prepare legacy Skill identity", async () => {
  const f = await fixture()
  try {
    const source = join(f.cwd, "README.md")
    await writeFile(source, "FILE_BODY_MUST_NOT_BE_AUTO_READ")
    const [file] = await f.service.prepare("session", f.cwd, [source])
    f.sessions.skillResources = async () => { throw new Error("native Skill must not be resolved as material") }
    const text = "/skill:unknown.name 用原文参数"
    const prompt = await f.service.resolveForPrompt({
      sessionId: "session", cwd: f.cwd, text,
      materials: [{ id: "old-skill", name: "review", kind: "Skill", type: "skill", source: "old source", status: "failed" }, file],
      model: { input: ["text"] }, nativeSkills: true,
    })
    assert.equal(prompt.text, text)
    assert.deepEqual(prompt.displayMaterials, [file])
    assert.match(prompt.textPrefix, /Referenced files \(not read\)/u)
    assert.doesNotMatch(prompt.textPrefix, /FILE_BODY_MUST_NOT_BE_AUTO_READ|<skill/u)
  } finally { await cleanupFixture(f.directory) }
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
    await cleanupFixture(f.directory)
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
    await cleanupFixture(f.directory)
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
    await cleanupFixture(f.directory)
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
    await cleanupFixture(f.directory)
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
    await cleanupFixture(f.directory)
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
    await cleanupFixture(f.directory)
  }
})

test("an oversized path image keeps its permanent preparation reason after restart without reading or granting a fixed identity", async () => {
  const f = await fixture()
  try {
    const source = join(f.cwd, "超限.png")
    await writeFile(source, Buffer.alloc(8 * 1024 * 1024 + 1))
    const [failed] = await f.service.prepare("session", f.cwd, [source])
    assert.equal(failed.type, "file")
    assert.equal(failed.status, "failed")
    assert.equal(failed.retryable, false)
    assert.match(failed.error, /8MiB/u)
    const draft = join(f.directory, "failed-image.json")
    await writeFile(draft, JSON.stringify(failed))
    await rm(source)
    const restarted = new MaterialService(join(f.directory, "data"), f.sessions)
    const saved = JSON.parse(await readFile(draft, "utf8"))
    assert.deepEqual((await restarted.restore("session", f.cwd, [saved]))[0], failed)
    assert.deepEqual((await restarted.restore("session", f.cwd, [{ ...saved, status: "preparing" }]))[0], failed)
    await assert.rejects(stat(restarted.directory), { code: "ENOENT" })
    await assert.rejects(restarted.resolveForPrompt({ sessionId: "session", cwd: f.cwd, materials: [saved], text: "检查图片" }), /尚未就绪/u)
    const [unknown] = await restarted.restore("session", f.cwd, [{ ...saved, id: "f".repeat(64), retryable: true }])
    assert.equal(unknown.status, "failed")
    assert.equal(unknown.retryable, false)
    assert.notEqual(unknown.error, saved.error)
    const [pretendReady] = await restarted.restore("session", f.cwd, [{ ...saved, status: "ready" }])
    assert.equal(pretendReady.status, "failed")
    assert.equal(pretendReady.retryable, false)
    await writeFile(source, image)
    const [reselected] = await restarted.prepare("session", f.cwd, [source])
    assert.equal(reselected.status, "ready", reselected.error)
    assert.equal(reselected.type, "image")
    assert.notEqual(reselected.id, failed.id)
  } finally {
    await cleanupFixture(f.directory)
  }
})
