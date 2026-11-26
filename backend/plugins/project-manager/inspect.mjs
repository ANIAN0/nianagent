import { lstat, open, readdir, realpath } from "node:fs/promises"
import { join } from "node:path"
import { parse } from "smol-toml"

export const targets = {
  "Moon / Pi": ".pi/mcp.json",
  Codex: ".codex/config.toml",
  "Claude Code": ".mcp.json",
  Antigravity: ".agents/mcp_config.json",
}

export async function readLocal(root, relative) {
  const file = join(root, relative)
  try {
    if (!(await lstat(file)).isFile() || (await realpath(file)) !== file)
      throw new Error("配置路径不是项目内的普通文件")
    const handle = await open(file, "r")
    try {
      if ((await handle.stat()).size > 2_000_000)
        throw new Error("文件超过 2 MB")
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await handle.readFile()
      )
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

async function inspectSkills(root, signal, sources) {
  const rows = new Map()
  const problems = []
  for (const base of [".agents/skills", ".claude/skills"]) {
    const folder = join(root, base)
    let entries
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch (error) {
      if (error.code !== "ENOENT") problems.push(base + " 无法读取")
      continue
    }
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const path = join(folder, entry.name)
      let canonical = path
      let state = entry.isSymbolicLink() ? "unknownLink" : "local"
      try {
        canonical = await realpath(path)
        if (sources.has(canonical))
          state = entry.isSymbolicLink() ? "sharedLink" : "source"
        const file = await lstat(join(canonical, "SKILL.md")).catch((error) => {
          if (error.code !== "ENOENT") throw error
        })
        if (!file?.isFile()) state = "missingManifest"
      } catch (error) {
        state = error.code === "ENOENT" ? "broken" : "unreadable"
      }
      const prior = rows.get(canonical)
      if (prior) prior.path += "\n" + path
      else rows.set(canonical, { name: entry.name, path, state })
    }
  }
  return { items: [...rows.values()], error: problems.join("；") }
}

export async function inspect(root, signal, sources) {
  const [skills, services, agents] = await Promise.all([
    inspectSkills(root, signal, sources),
    Promise.all(
      Object.entries(targets).map(async ([client, path]) => {
        try {
          const raw = await readLocal(root, path)
          if (raw === null) return { items: [], path, raw }
          const doc =
            client === "Codex"
              ? parse(raw.replace(/^\uFEFF/, ""))
              : JSON.parse(raw.replace(/^\uFEFF/, ""))
          const map =
            doc[client === "Codex" ? "mcp_servers" : "mcpServers"] ?? {}
          if (
            !doc ||
            typeof doc !== "object" ||
            Array.isArray(doc) ||
            typeof map !== "object" ||
            Array.isArray(map)
          )
            throw new Error()
          return {
            path,
            raw,
            items: Object.keys(map).map((name) => ({
              name,
              path,
              client,
              scope: "project",
              state: "unverified",
            })),
          }
        } catch {
          return { items: [], error: path + " 无法读取或配置格式有误" }
        }
      })
    ),
    readLocal(root, "AGENTS.md").then(
      (content) => ({
        exists: content !== null,
        content: content ?? "",
        error: "",
      }),
      () => ({
        exists: false,
        content: "",
        error: "AGENTS.md 无法读取，请检查文件类型、大小、编码与权限。",
      })
    ),
  ])
  signal?.throwIfAborted()
  return {
    mcpFiles: new Map(
      services.filter((s) => s.path).map((s) => [s.path, s.raw])
    ),
    skills,
    agents,
    mcp: {
      items: services.flatMap((s) => s.items),
      error: services
        .map((s) => s.error)
        .filter(Boolean)
        .join("；"),
    },
  }
}
