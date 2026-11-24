import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const workbenchSettingsFile = (plugins) =>
  join(plugins, "workbench-settings.json")

export function workbenchDirectories(plugins) {
  return {
    notes: join(plugins, "notes-workbench"),
    skills: join(plugins, "skill-workbench"),
  }
}

async function readSettings(file) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"))
    if (
      !Number.isSafeInteger(value?.revision) ||
      value.revision < 0 ||
      !Number.isInteger(value.port) ||
      value.port < 1024 ||
      value.port > 65535
    )
      throw new Error("配置字段无效")
    return { port: value.port, revision: value.revision }
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw new Error(`工作台端口配置无法读取，原文件已保留：${file}`, {
      cause: error,
    })
  }
}

export async function readWorkbenchSettings(plugins) {
  const dirs = workbenchDirectories(plugins)
  return (
    (await readSettings(workbenchSettingsFile(plugins))) ??
    (await readSettings(join(dirs.notes, "settings.json"))) ??
    (await readSettings(join(dirs.skills, "settings.json"))) ?? {
      port: 19830,
      revision: 0,
    }
  )
}
