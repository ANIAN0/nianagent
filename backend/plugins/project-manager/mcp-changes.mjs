import { randomUUID } from "node:crypto"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { replaceJson, withAcquiredLock } from "../../atomic-file.mjs"
import { planMcp, applyMcp, readPreview } from "./mcp-files.mjs"
export function createMcpChanges(host, project) {
  async function previewConfig(
    { projectId, change, entry, seen, info },
    signal
  ) {
    if (change.kind === "mcp.cleanup") {
      const proof = await host.mcp.cleanupEvidence(entry.path, change.entryName)
      const previewId = randomUUID()
      const { path } = await host.mcp.personal()
      await replaceJson(
        join(host.directory, "previews", previewId + ".json"),
        {
          kind: "cleanup",
          projectId,
          root: entry.path,
          name: change.entryName,
          proof,
        },
        { signal }
      )
      return {
        previewId,
        diff:
          "移除 Moon / Pi 个人服务 " +
          change.entryName +
          "\n" +
          path +
          "\n项目连接验证时间 " +
          proof.testedAt,
      }
    }

    const bind = change.kind !== "mcp.remove"
    const definition = bind
      ? (await host.mcp.definitions()).find(
          (d) => d.name === change.definitionId
        )
      : undefined
    if (bind && !definition) throw new Error("服务定义已删除。")
    const clients = change.targets ?? [change.target]
    const files = await Promise.all(
      clients.map((client) =>
        planMcp(
          entry.path,
          client,
          change.entryName,
          definition,
          change.kind === "mcp.update"
        )
      )
    )
    if (files.some((f) => seen.mcpFiles.get(f.file) !== f.before))
      throw new Error("MCP 配置在读取后已变化，请刷新并重新预览。")
    const previewId = randomUUID()
    await replaceJson(
      join(host.directory, "previews", previewId + ".json"),
      {
        kind: "mcp",
        projectId,
        root: entry.path,
        ino: String(info.ino),
        dev: String(info.dev),
        files,
        ...(definition
          ? {
              definitionId: definition.name,
              definitionRevision: definition.revision ?? 1,
            }
          : {}),
      },
      { signal }
    )
    return {
      previewId,
      diff: files
        .map(
          (item) =>
            item.file +
            " · " +
            (change.kind === "mcp.update"
              ? "更新 "
              : bind
                ? "添加 "
                : "移除 ") +
            change.entryName
        )
        .join("\n"),
    }
  }
  async function applyConfig(preview, previewId, signal) {
    if (preview.kind === "cleanup") {
      if (preview.outcome === "written")
        return { outcome: "written", reason: "个人项已移除。" }
      const entry = await project(preview.projectId, signal)
      if (entry.path !== preview.root) throw new Error("项目已变化。")
      await host.mcp.removeVerified(
        entry.path,
        preview.name,
        preview.proof,
        previewId,
        signal
      )
      await replaceJson(join(host.directory, "previews", previewId + ".json"), {
        ...preview,
        outcome: "written",
      })
      return { outcome: "written", reason: "个人项已移除。" }
    }

    const entry = await project(preview.projectId, signal)
    if (entry.path !== preview.root) throw new Error("项目已变化。")
    if (
      preview.definitionId &&
      !preview.files.every((f) => f.outcome === "written") &&
      !(await host.mcp.definitions()).some(
        (d) =>
          d.name === preview.definitionId &&
          (d.revision ?? 1) === preview.definitionRevision
      )
    )
      throw new Error("定义已变化，请重新预览。")
    const stateFile = join(host.directory, "previews", previewId + ".json")
    const unlock = await lockfile.lock(stateFile, { retries: 5 })
    return withAcquiredLock(unlock, async () =>
      applyMcp(await readPreview(stateFile), stateFile, signal)
    )
  }
  return { previewConfig, applyConfig }
}
