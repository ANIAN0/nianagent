import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
} from "node:fs/promises"
import { dirname, join, relative, isAbsolute, sep } from "node:path"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import { prepareReplacement, applyReplacement } from "./replacement.mjs"
import { replaceJson, withAcquiredLock } from "../../atomic-file.mjs"

const safe = (name) =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(name) &&
  !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)
const nested = (a, b) => {
  const part = relative(a, b)
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part)
}
async function info(path) {
  try {
    return await lstat(path, { bigint: true })
  } catch (e) {
    if (e.code !== "ENOENT") throw e
  }
}
const identity = (i) => (i ? [i.dev, i.ino, i.ctimeNs].join(":") : "")
async function tree(path, signal) {
  signal?.throwIfAborted()
  const entry = await lstat(path)
  if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
    throw new Error("Skill 包含嵌套链接或特殊文件。")
  if (entry.isDirectory())
    for (const name of await readdir(path)) await tree(join(path, name), signal)
}
async function parents(root, base, create) {
  if (![".agents/skills", ".claude/skills"].includes(base))
    throw new Error("未知的安装位置。")
  let dir = root
  for (const piece of base.split("/")) {
    dir = join(dir, piece)
    if (create)
      try {
        await mkdir(dir)
      } catch (e) {
        if (e.code !== "EEXIST") throw e
      }
    const i = await info(dir)
    if (i && (!i.isDirectory() || (await realpath(dir)) !== dir))
      throw new Error("安装目录已改向。")
  }
  return dir
}

export function createProjectSkills(host, supervisor) {
  const dir = join(host.directory, "project-skills")
  async function api(path, signal, body) {
    if (!(await supervisor.isRunning()))
      throw new Error("请在「插件 → Skill 工作台」启动工作台。")
    const r = await fetch(supervisor.baseUrl() + "/api/skills" + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      redirect: "error",
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
    if (!r.ok) throw new Error("工作台请求失败（HTTP " + r.status + "）。")
    return r.json()
  }
  async function state() {
    try {
      return JSON.parse(await readFile(join(dir, "state.json"), "utf8"))
    } catch (e) {
      if (e.code !== "ENOENT") throw e
      return { sources: {}, bindings: {} }
    }
  }
  async function list(signal) {
    const rows = (await api("", signal)).skills
    const doc = await state()
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      version: row.currentVersion,
      source: doc.sources[row.id]?.path ?? "",
    }))
  }
  async function project(id, signal) {
    const entry = (await host.projects.list(signal)).find((p) =>
      p.aliases.includes(id)
    )
    if (!entry?.available) throw new Error("项目不可访问。")
    return entry
  }
  async function expire() {
    await mkdir(join(dir, "operations"), { recursive: true })
    const release = await lockfile.lock(dir, { retries: 5 })
    return withAcquiredLock(release, async () => {
      for (const name of await readdir(join(dir, "operations"))) {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue
        const file = join(dir, "operations", name)
        const metadata = await lstat(file)
        if (Date.now() - metadata.mtimeMs < 30 * 60_000) continue
        const plan = JSON.parse(await readFile(file, "utf8"))
        if (
          plan.outcome !== "pending" ||
          plan.started ||
          plan.replacement?.swap ||
          !(Date.now() >= plan.expiresAt)
        )
          continue
        const path = plan.replacement?.work
        if (
          path &&
          dirname(path) === dir &&
          /^preview-[A-Za-z0-9]+$/.test(relative(dir, path))
        )
          await rm(path, { recursive: true, force: true })
        await rm(file)
      }
    })
  }
  async function prepare(input, signal) {
    await expire()
    const { projectId, libraryId, location, mode } = input
    const entry = await project(projectId, signal)
    const library = await list(signal)
    let row = library.find((r) => r.id === libraryId)
    const slug = libraryId.startsWith("local--") ? libraryId.slice(7) : ""
    if (
      !row &&
      mode === "source" &&
      /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(slug) &&
      !library.some((r) => r.slug === slug)
    )
      row = { id: libraryId, slug, name: slug, version: 0, source: "" }
    if (!row || !safe(row.slug) || !safe(row.id))
      throw new Error("无效的库条目。")
    const target = join(await parents(entry.path, location, false), row.slug)
    const current = await info(target)
    const replacing = ["publish", "takeover", "detach"].includes(mode)
    if (replacing) {
      if (!row.source) throw new Error("请先登记共享源。")
    } else if (mode === "source") {
      if (
        row.source ||
        !current?.isDirectory() ||
        (await realpath(target)) !== target
      )
        throw new Error("请选择未登记共享源的本地 Skill。")
      if (!(await lstat(join(target, "SKILL.md"))).isFile())
        throw new Error("缺少 SKILL.md。")
      await tree(target, signal)
    } else if (mode === "unlink") {
      if (
        !current?.isSymbolicLink() ||
        !row.source ||
        (await realpath(target)) !== row.source
      )
        throw new Error("仅可解绑指向此共享源的目录链接。")
    } else if (current)
      throw new Error("安装位置已有同名内容，请先核对并保留原目录。")
    else if (!row.source && row.version < 1)
      throw new Error("请先在工作台发布版本，或登记已有项目目录作为共享源。")
    const previewId = randomUUID()
    const rootInfo = await info(entry.path)
    const plan = {
      expiresAt: Date.now() + 30 * 60_000,
      ...input,
      root: entry.path,
      rootIdentity: [rootInfo.dev, rootInfo.ino].join(":"),
      target,
      targetIdentity: identity(current),
      row,
      sourceIdentity: row.source ? identity(await info(row.source)) : "",
      outcome: "pending",
      reason: "",
    }
    let summary
    if (replacing) {
      const doc = await state()
      plan.baseVersion = doc.sources[libraryId]?.version
      summary = await prepareReplacement(
        plan,
        dir,
        async (base, version) => {
          await mkdir(base, { recursive: true })
          const exported = await api(
            "/" + encodeURIComponent(libraryId) + "/export",
            signal,
            { targetDir: base, versionNumber: version }
          )
          if (exported.skillDir !== join(base, row.slug))
            throw new Error("导出目录不符。")
          return exported.skillDir
        },
        Object.values(doc.bindings),
        signal
      )
    }
    if (summary?.conflicts) return summary
    await replaceJson(join(dir, "operations", previewId + ".json"), plan, {
      signal,
    })
    const action = {
      source: "登记共享源",
      link: "创建共享链接",
      copy: "安装独立副本",
      unlink: "解除项目链接",
    }
    return {
      previewId,
      diff:
        summary ??
        action[mode] +
          "\n" +
          target +
          "\n" +
          (row.source || "工作台版本 " + row.version),
    }
  }
  const fileFor = (id) => join(dir, "operations", id + ".json")
  async function result(id) {
    const { outcome, reason } = JSON.parse(await readFile(fileFor(id), "utf8"))
    return { outcome, reason }
  }
  async function registerSource(id, plan, doc, signal) {
    const { row, target } = plan
    let libraryId = plan.libraryId
    const source = doc.sources[libraryId]?.path
    if (source && source !== target) throw new Error("库条目已有关联源。")
    await tree(target, signal)
    if (libraryId.startsWith("local--")) {
      const file = join(target, "SKILL.md")
      if ((await lstat(file)).size > 500000)
        throw new Error("Skill 正文超出工作台导入上限。")
      const content = await readFile(file, "utf8")
      const description = "从项目目录登记的共享 Skill（" + id + "）"
      let created = (await api("", signal)).skills.find(
        (s) => s.slug === row.slug
      )
      if (created && created.description !== description)
        throw new Error("工作台已有同名条目，请重新预览关联。")
      if (!created) {
        plan.started = true
        await replaceJson(fileFor(id), plan, { signal })
        const result = await api("", signal, {
          name: row.name,
          slug: row.slug,
          description,
          reason: "从项目登记共享源",
          initialBlocks: [{ content }],
        })
        created = result.skill
      }
      libraryId = created.id
      if (
        doc.sources[libraryId]?.path &&
        doc.sources[libraryId].path !== target
      )
        throw new Error("工作台条目已有共享源。")
    }
    doc.sources[libraryId] = { path: target, version: 0 }
  }
  async function installBinding(file, plan, doc, signal) {
    const { libraryId, row, mode, target } = plan
    let source = doc.sources[libraryId]?.path
    if (!source) {
      const base = await mkdtemp(join(dir, "source-"))
      try {
        const exported = await api(
          "/" + encodeURIComponent(libraryId) + "/export",
          signal,
          { targetDir: base, versionNumber: row.version }
        )
        if (exported.skillDir !== join(base, row.slug))
          throw new Error("导出目录不符。")
        source = await realpath(exported.skillDir)
        doc.sources[libraryId] = { path: source, version: row.version }
        await replaceJson(join(dir, "state.json"), doc)
      } catch (error) {
        if (!signal?.aborted) await rm(base, { recursive: true, force: true })
        throw error
      }
    }
    if (nested(target, source) || nested(source, target))
      throw new Error("共享源与目标目录不能相互包含。")
    await tree(source, signal)
    plan.started = true
    await replaceJson(file, plan, { signal })
    if (mode === "link")
      await symlink(
        source,
        target,
        process.platform === "win32" ? "junction" : "dir"
      )
    else if (mode === "unlink") {
      if ((await realpath(target)) !== source) throw new Error("链接已改向。")
      await unlink(target)
    } else {
      const stage = await mkdtemp(join(dirname(target), ".moon-copy-"))
      try {
        await cp(source, stage, { recursive: true, dereference: false })
        await tree(stage, signal)
        const staged = await info(stage)
        plan.copyIdentity = [staged.dev, staged.ino].join(":")
        await replaceJson(file, plan, { signal })
        if (await info(target)) throw new Error("目标目录已存在。")
        await rename(stage, target)
      } finally {
        await rm(stage, { recursive: true, force: true })
      }
    }
  }
  async function apply(id, signal) {
    const file = fileFor(id)
    const release = await lockfile.lock(dir, { retries: 5 })
    return withAcquiredLock(release, async (committed) => {
      const plan = JSON.parse(await readFile(file, "utf8"))
      if (plan.outcome === "written") return result(id)
      if (
        !plan.started &&
        !plan.replacement?.swap &&
        Date.now() >= plan.expiresAt
      )
        throw new Error("预览已过期，请重新预览。")
      const { mode, target, row } = plan
      const libraryId = plan.libraryId
      const entry = await project(plan.projectId, signal)
      const rootInfo = await info(entry.path)
      if (
        entry.path !== plan.root ||
        [rootInfo.dev, rootInfo.ino].join(":") !== plan.rootIdentity
      )
        throw new Error("项目已移动。")
      await parents(entry.path, plan.location, true)
      const doc = await state()
      const current = await info(target)
      const source = doc.sources[libraryId]?.path
      const bindingKey = JSON.stringify([
        plan.projectId,
        plan.location,
        libraryId,
      ])
      if (plan.replacement) {
        if (
          source !== row.source ||
          (mode === "publish" &&
            doc.sources[libraryId].version !== plan.baseVersion &&
            !plan.replacement.swap)
        )
          throw new Error("共享源基线已更新。")
        await applyReplacement(plan, () => replaceJson(file, plan), signal)
        if (mode === "publish") doc.sources[libraryId].version = row.version
      } else if (
        plan.started &&
        ((mode === "link" &&
          current?.isSymbolicLink() &&
          (await realpath(target)) === source) ||
          (mode === "unlink" && !current) ||
          (mode === "copy" &&
            current &&
            identity(current).split(":").slice(0, 2).join(":") ===
              plan.copyIdentity))
      ) {
        // Reconcile a filesystem commit whose acknowledgement was interrupted.
      } else {
        if (identity(current) !== plan.targetIdentity)
          throw new Error("安装目标已变化，请重新预览。")
        if (
          row.source &&
          (source !== row.source ||
            identity(await info(source)) !== plan.sourceIdentity)
        )
          throw new Error("共享源已变化，请重新预览。")
        signal?.throwIfAborted()
        if (mode === "source") {
          await registerSource(id, plan, doc, signal)
        } else {
          await installBinding(file, plan, doc, signal)
        }
      }
      if (mode === "unlink") delete doc.bindings[bindingKey]
      else if (!["source", "publish"].includes(mode))
        doc.bindings[bindingKey] = {
          libraryId,
          projectId: entry.id,
          target,
          mode:
            mode === "takeover" ? "link" : mode === "detach" ? "copy" : mode,
        }
      await replaceJson(join(dir, "state.json"), doc)
      committed()
      plan.outcome = "written"
      await replaceJson(file, plan)
      return result(id)
    })
  }
  return {
    list,
    prepare,
    apply,
    result,
    sharedSources: async () =>
      Object.values((await state()).sources).map((s) => s.path),
  }
}
