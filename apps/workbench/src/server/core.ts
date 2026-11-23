import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { workbenchPort } from "./workbench-port"

export type WorkbenchAppKind = "notes" | "skills"

export type SharedCore = {
  backendDir: string
  appKind: WorkbenchAppKind
  dataDir: string
  port: number
  importMjs: (filePath: string) => Promise<Record<string, unknown>>
}

const globalForCore = globalThis as unknown as {
  __moonWorkbenchCore?: Promise<SharedCore>
}

export function repoRoot(): string {
  if (process.env.MOON_REPO_ROOT) return resolve(process.env.MOON_REPO_ROOT)
  const cwd = process.cwd()
  if (cwd.endsWith("workbench") || cwd.endsWith("notes-workbench")) {
    return resolve(cwd, "../..")
  }
  return cwd
}

function resolveAppKind(): WorkbenchAppKind {
  return process.env.MOON_WORKBENCH_APP === "skills" ? "skills" : "notes"
}

async function createSharedCore(): Promise<SharedCore> {
  const root = repoRoot()
  const appKind = resolveAppKind()
  const port = workbenchPort()

  const defaultDataDir = join(
    root,
    ".dev",
    "moon",
    "data",
    "plugins",
    appKind === "skills" ? "skill-workbench" : "notes-workbench"
  )
  const dataDir =
    process.env.MOON_WORKBENCH_DATA_DIR ||
    process.env.MOON_NOTES_DATA_DIR ||
    defaultDataDir

  await mkdir(dataDir, { recursive: true })

  const importMjs = (filePath: string) =>
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(
        filePath
      ).href
    ) as Promise<Record<string, unknown>>

  return {
    backendDir: resolve(
      /* turbopackIgnore: true */
      process.env.MOON_WORKBENCH_BACKEND_DIR || join(root, "backend")
    ),
    appKind,
    dataDir,
    port,
    importMjs,
  }
}

export function getSharedCore(): Promise<SharedCore> {
  if (!globalForCore.__moonWorkbenchCore) {
    globalForCore.__moonWorkbenchCore = createSharedCore().catch((error) => {
      globalForCore.__moonWorkbenchCore = undefined
      throw error
    })
  }
  return globalForCore.__moonWorkbenchCore
}

export function newTraceId(): string {
  return randomUUID()
}
