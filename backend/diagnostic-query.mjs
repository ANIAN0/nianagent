// @ts-check
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { filterDiagnosticRecords, readDiagnosticFile } from "./logger.mjs"

/** Merge process-owned diagnostics without allowing the reader to rotate another writer's files. */
export function createDiagnosticQuery(directory, nodeLogger) {
  let rustStatus = { dropped: 0, issue: "" }
  return {
    async query(input = {}) {
      // Validate before touching disk and collect enough per process for a global top-N.
      filterDiagnosticRecords([], input)
      const records = await nodeLogger.query({ ...input, limit: 500 })
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (error.code === "ENOENT") entries = []
        else throw error
      }
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          !["moon-rust.jsonl", "moon-rust.jsonl.1"].includes(entry.name)
        )
          continue
        records.push(...(await readDiagnosticFile(join(directory, entry.name))))
      }
      try {
        const status = JSON.parse(
          await readFile(join(directory, "moon-rust-status.json"), "utf8")
        )
        if (
          !Number.isSafeInteger(status.dropped) ||
          status.dropped < 0 ||
          typeof status.issue !== "string"
        )
          throw new Error("桌面诊断状态格式无效。")
        rustStatus = status
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
      return filterDiagnosticRecords(records, input)
    },
    status() {
      const state = nodeLogger.status()
      return {
        queued: state.queued,
        dropped: state.dropped + rustStatus.dropped,
        issue: [state.issue, rustStatus.issue].filter(Boolean).join("；"),
      }
    },
  }
}
