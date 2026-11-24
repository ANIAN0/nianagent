import { randomUUID } from "node:crypto"
import { workbenchDirectories } from "../../../../backend/workbench-settings.mjs"
import { join, resolve } from "node:path"
import { workbenchPort } from "./workbench-port"

export function repoRoot(): string {
  if (process.env.MOON_REPO_ROOT) return resolve(process.env.MOON_REPO_ROOT)
  const cwd = process.cwd()
  if (cwd.endsWith("workbench") || cwd.endsWith("notes-workbench")) {
    return resolve(cwd, "../..")
  }
  return cwd
}

export function getSharedCore() {
  const root =
    process.env.MOON_DATA_DIR || join(repoRoot(), ".dev", "moon", "data")
  const dirs = workbenchDirectories(join(root, "plugins"))
  // 原单模块命令传入的目录只属于被指定的模块。
  const legacy = process.env.MOON_WORKBENCH_DATA_DIR
  const legacySkills = process.env.MOON_WORKBENCH_APP === "skills"
  return {
    port: workbenchPort(),
    dataDirs: {
      notes: resolve(
        process.env.MOON_NOTES_DATA_DIR ||
          (!legacySkills && legacy) ||
          dirs.notes
      ),
      skills: resolve(
        process.env.MOON_SKILLS_DATA_DIR ||
          (legacySkills && legacy) ||
          dirs.skills
      ),
    },
  }
}

export function newTraceId(): string {
  return randomUUID()
}
