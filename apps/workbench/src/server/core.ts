import { randomUUID } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { workbenchPort } from "./workbench-port"

export type WorkbenchAppKind = "notes" | "skills"

export type SharedCore = {
  backendDir: string
  appKind: WorkbenchAppKind
  dataDir: string
  port: number
  token: string | null
  importMjs: (filePath: string) => Promise<Record<string, unknown>>
  issueTicket: (app?: WorkbenchAppKind) => string
  consumeTicket: (ticket: string) => { valid: boolean; app: WorkbenchAppKind }
  authorize: (request: Request) => boolean
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

  let token: string | null =
    process.env.MOON_WORKBENCH_TOKEN?.trim() ||
    process.env.MOON_NOTES_TOKEN?.trim() ||
    null

  if (!token) {
    try {
      const saved = JSON.parse(
        await readFile(join(dataDir, "token.json"), "utf8")
      ) as { token?: string }
      if (typeof saved.token === "string" && saved.token.trim()) {
        token = saved.token.trim()
      }
    } catch {
      // 独立本地开发模式下无 token.json 时允许免鉴权本机直连
    }
  }

  const tickets = new Map<string, { expires: number; app: WorkbenchAppKind }>()

  const issueTicket = (targetApp: WorkbenchAppKind = appKind) => {
    const now = Date.now()
    for (const [key, entry] of tickets) {
      if (entry.expires <= now) tickets.delete(key)
    }
    const ticket = randomUUID()
    tickets.set(ticket, { expires: now + 60_000, app: targetApp })
    return ticket
  }

  const consumeTicket = (ticket: string) => {
    const entry = tickets.get(ticket)
    if (!entry) return { valid: false, app: appKind }
    tickets.delete(ticket)
    return { valid: entry.expires > Date.now(), app: entry.app }
  }

  const authorize = (request: Request) => {
    if (!token) return true
    const header = request.headers.get("authorization") || ""
    if (header === `Bearer ${token}`) return true
    const cookieHeader = request.headers.get("cookie") || ""
    for (const part of cookieHeader.split(";")) {
      const [key, ...rest] = part.trim().split("=")
      if (key === "moon_workbench_token" || key === "moon_notes_token") {
        if (decodeURIComponent(rest.join("=")) === token) {
          return true
        }
      }
    }
    return false
  }

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
    token,
    importMjs,
    issueTicket,
    consumeTicket,
    authorize,
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
