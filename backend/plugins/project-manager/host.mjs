import { createJournal } from "./journal.mjs"
import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { createMcpChanges } from "./mcp-changes.mjs"
import { replaceJson } from "../../atomic-file.mjs"
import { summarizeMcp } from "./mcp-files.mjs"
import { globalSources, importDefinition } from "./mcp-sources.mjs"
import { inspect } from "./inspect.mjs"
import { projectManagerOperations } from "./contract.mjs"

export async function activate(host) {
  const observations = new Map()
  async function project(id, signal) {
    const entry = (await host.projects.list(signal)).find((row) =>
      row.aliases.includes(id)
    )
    if (!entry?.available) throw new Error("目录已失联或取消登记，请刷新。")
    return entry
  }
  const agents = (operation, payload, signal) =>
    plugin("agents-md", operation, payload, signal)
  const skills = (operation, payload, signal) =>
    plugin("skill-workbench", operation, payload, signal)
  async function plugin(id, operation, payload, signal) {
    let response
    try {
      response = await host.dispatch(
        "pluginCall",
        { id, operation, payload: JSON.stringify(payload) },
        signal
      )
    } catch (error) {
      if (error.message === "请先启用插件。")
        throw new Error(
          "请在「插件 → " +
            (id === "agents-md" ? "AGENTS.md 管理" : "Skill 工作台") +
            "」启用后重试。",
          { cause: error }
        )
      throw error
    }
    return JSON.parse(response.payload).value
  }
  const mcpChanges = createMcpChanges(host, project)
  const journal = createJournal(host.directory)
  const record = journal.read
  async function receipt(requestId, signal) {
    const { previewId } = await record("requests", requestId)
    const preview = await record("previews", previewId)
    if (preview.kind === "cleanup")
      return {
        outcome: preview.outcome ?? "pending",
        reason: preview.reason ?? "",
      }
    if (preview.kind === "skill")
      return skills("installResult", { previewId }, signal)
    if (preview.kind === "mcp") return summarizeMcp(preview)
    const result = await agents(
      "replaceResult",
      { publicationId: previewId },
      signal
    )
    const { outcome, reason } = result.results[0]
    return { outcome, reason }
  }
  const methods = {
    async inheritedMcp({ projectId }, signal) {
      await project(projectId, signal)
      return globalSources(host)
    },
    async importMcp({ projectId, target, entryName }, signal) {
      const entry = await project(projectId, signal)
      return importDefinition(host, entry.path, target, entryName, signal)
    },
    async listSkills({ projectId }, signal) {
      await project(projectId, signal)
      return skills("listProjectSkills", {}, signal)
    },
    async readDefinition({ name }) {
      const entry = (await host.mcp.definitions()).find((d) => d.name === name)
      if (!entry) throw new Error("定义不存在。")
      return { envRefs: {}, headerRefs: {}, revision: 1, ...entry }
    },
    listDefinitions: async () =>
      (await host.mcp.definitions()).map((d) => d.name),
    saveDefinition: (input, signal) => host.mcp.saveDefinition(input, signal),
    async projectTrust({ projectId, trusted }, signal) {
      const entry = await project(projectId, signal)
      return host.mcp.trust(entry.path, trusted)
    },
    async verifyMcp({ projectId, entryName }, signal) {
      const entry = await project(projectId, signal)
      const { state, testedAt, error } = await host.mcp.verify(
        entry.path,
        entryName,
        signal
      )
      return { state, testedAt, error }
    },
    async listProjects({ query = "" }, signal) {
      await journal.sweep()
      const rows = await host.projects.list(signal)
      return rows.filter((row) =>
        (row.name + "\n" + row.path).toLowerCase().includes(query.toLowerCase())
      )
    },
    async chooseDirectory(_input, signal) {
      const path = await host.workspaces.pickDirectory(signal)
      return path
        ? { cancelled: false, path: await host.projects.register(path, signal) }
        : { cancelled: true, path: "" }
    },
    async unregister({ projectId }, signal) {
      await host.projects.unregister(projectId, signal)
      return { removed: true }
    },
    async inspectProject({ projectId }, signal) {
      const entry = await project(projectId, signal)
      const info = await stat(entry.path, { bigint: true })
      let sources = [],
        sourceError = ""
      try {
        sources = await skills("sharedSources", {}, signal)
      } catch (error) {
        signal?.throwIfAborted()
        if (error.name === "AbortError") throw error
        sourceError = "未能核对共享源。" + error.message
      }
      signal?.throwIfAborted()
      const { mcpFiles, ...detail } = await inspect(
        entry.path,
        signal,
        new Set(sources)
      )
      if (sourceError)
        detail.skills.error = [detail.skills.error, sourceError]
          .filter(Boolean)
          .join("；")
      const revision = randomUUID()
      while (observations.size >= 32)
        observations.delete(observations.keys().next().value)
      observations.set(revision, {
        projectId,
        path: entry.path,
        ino: info.ino,
        dev: info.dev,
        mcpFiles,
        agents: detail.agents,
      })
      return { revision, ...detail }
    },
    async listLibrary({ projectId }, signal) {
      await project(projectId, signal)
      const data = await agents("projectLibrary", { projectId }, signal)
      return {
        ...data,
        snippets: data.snippets.map(({ id, name, content }) => ({
          id,
          name,
          content,
        })),
      }
    },
    saveTemplate: (input, signal) =>
      agents("saveProjectTemplate", input, signal),
    async previewChange({ projectId, expectedRevision, change }, signal) {
      const entry = await project(projectId, signal)
      await journal.sweep()
      const seen = observations.get(expectedRevision)
      const info = await stat(entry.path, { bigint: true })
      if (
        !seen ||
        seen.projectId !== projectId ||
        seen.path !== entry.path ||
        seen.dev !== info.dev ||
        seen.ino !== info.ino
      )
        throw new Error("项目已变化，请刷新后重新预览。")
      if (change.kind === "skill.bind") {
        const { libraryId, location, mode, decisions } = change
        const result = await skills(
          "previewInstall",
          { projectId, libraryId, location, mode, decisions },
          signal
        )
        if (result.conflicts) return result
        await replaceJson(
          join(host.directory, "previews", result.previewId + ".json"),
          { kind: "skill" },
          { signal }
        )
        return result
      }
      if (change.kind.startsWith("mcp."))
        return mcpChanges.previewConfig(
          { projectId, change, entry, seen, info },
          signal
        )
      if (seen.agents.error) throw new Error(seen.agents.error)
      const content = change.content ?? ""
      const result = await agents(
        "previewProjectEdit",
        {
          projectId,
          original: seen.agents.content,
          exists: seen.agents.exists,
          content,
          ...(change.kind === "agents.append"
            ? { snippetIds: change.snippetIds, resolution: change.resolution }
            : {}),
        },
        signal
      )
      await replaceJson(
        join(host.directory, "previews", result.publicationId + ".json"),
        { revision: result.revision, path: result.path },
        { signal }
      )
      return { previewId: result.publicationId, diff: result.diff }
    },
    async applyChange({ previewId, requestId }, signal) {
      return journal.apply(previewId, requestId, signal, async (preview) => {
        if (preview.kind === "skill")
          return skills("applyInstall", { previewId }, signal)
        if (["mcp", "cleanup"].includes(preview.kind))
          return mcpChanges.applyConfig(preview, previewId, signal)
        const result = await agents(
          "replaceProjects",
          {
            revision: preview.revision,
            paths: [preview.path],
            publicationId: previewId,
          },
          signal
        )
        const { outcome, reason } = result.results[0]
        return { outcome, reason }
      })
    },
    getReceipt: ({ requestId }, signal) => receipt(requestId, signal),
  }
  const operation = (name) => ({
    ...projectManagerOperations[name],
    execute: async (input, _context, signal) => ({
      value: await methods[name](input, signal),
    }),
  })
  return {
    close() {
      observations.clear()
    },
    operations: {
      listProjects: operation("listProjects"),
      chooseDirectory: operation("chooseDirectory"),
      unregister: operation("unregister"),
      inspectProject: operation("inspectProject"),
      saveTemplate: operation("saveTemplate"),
      listLibrary: operation("listLibrary"),
      previewChange: operation("previewChange"),
      applyChange: operation("applyChange"),
      getReceipt: operation("getReceipt"),
      projectTrust: operation("projectTrust"),
      verifyMcp: operation("verifyMcp"),
      readDefinition: operation("readDefinition"),
      listDefinitions: operation("listDefinitions"),
      saveDefinition: operation("saveDefinition"),
      inheritedMcp: operation("inheritedMcp"),
      importMcp: operation("importMcp"),
      listSkills: operation("listSkills"),
    },
  }
}
