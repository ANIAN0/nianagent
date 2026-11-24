import { openNotesDomain } from "./notes/domain.mjs"
import { PreviewInventory } from "./notes/preview-inventory.mjs"
import * as preview from "./notes/preview.mjs"
import { validatePluginValue } from "./validate"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { getSharedCore, newTraceId } from "./core"

export { newTraceId }

export type V2Operation = {
  title: string
  owner: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  effect?: string
  execute: (
    input: unknown,
    context: { source: string; actorId?: string; traceId: string },
    signal?: AbortSignal
  ) => Promise<{ value: unknown }>
}

type PreviewModule = typeof import("./notes/preview.mjs")
type PreviewManifest = { routes: Record<string, string> }

type NotesStore = {
  open: () => Promise<void>
  readAsset: (versionId: string, path: string) => Promise<Buffer>
  readVersionContent: (versionId: string) => Promise<{
    kind: string
    reading: { manifest?: PreviewManifest }
  }>
}

type NotesInventory = {
  capture: (
    versionId: string,
    manifest: PreviewManifest,
    page: string,
    elements: unknown[]
  ) => number
  get: (versionId: string) => unknown
}

export type WorkbenchRuntime = {
  dataDir: string
  port: number
  store: NotesStore
  v2: {
    operations: Record<string, V2Operation>
    close: () => Promise<void>
  }
  validatePluginValue: (schema: unknown, value: unknown) => unknown
  previewSessions: InstanceType<PreviewModule["PreviewSessions"]>
  previewInventories: NotesInventory
  preview: PreviewModule
  getDataVersion: () => number
  waitForSync: (
    since: number,
    signal?: AbortSignal
  ) => Promise<{ version: number; timeout?: boolean }>
}

const globalForRuntime = globalThis as unknown as {
  __moonNotesWorkbenchRuntime?: Promise<WorkbenchRuntime>
}

async function createRuntime(): Promise<WorkbenchRuntime> {
  const core = getSharedCore()
  await mkdir(join(core.dataDirs.notes, "v2"), { recursive: true })

  let dataVersion = Date.now()
  const waiters = new Set<() => void>()
  const notify = () => {
    dataVersion += 1
    for (const wake of [...waiters]) wake()
  }

  const previewInventories = new PreviewInventory()
  const previewSessions = new preview.PreviewSessions()
  const baseUrl = `http://127.0.0.1:${core.port}/`

  const { store, v2 } = await openNotesDomain(join(core.dataDirs.notes, "v2"), {
    event: () => {},
    baseUrl,
    logger: { append: () => {} },
    changed: () => notify(),
    openVersionUrl: (
      draftId: string,
      versionId: string,
      compareVersionId?: string
    ) => {
      const params = new URLSearchParams({ draft: draftId, version: versionId })
      if (compareVersionId) params.set("compare", compareVersionId)
      return `${baseUrl}notes#v2?${params}`
    },
    inventory: {
      forVersion: (versionId: string) => previewInventories.get(versionId),
    },
  })

  const waitForSync = (since: number, signal?: AbortSignal) => {
    if (since !== dataVersion) {
      return Promise.resolve({ version: dataVersion })
    }
    return new Promise<{ version: number; timeout?: boolean }>((resolve) => {
      const wake = (timeout = false) => {
        clearTimeout(timer)
        waiters.delete(onNotify)
        signal?.removeEventListener("abort", onAbort)
        resolve({ version: dataVersion, timeout })
      }
      const onNotify = () => wake(false)
      const onAbort = () => wake(true)
      const timer = setTimeout(() => wake(true), 25000)
      waiters.add(onNotify)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  return {
    dataDir: core.dataDirs.notes,
    port: core.port,
    store,
    v2,
    validatePluginValue,
    previewSessions,
    previewInventories,
    preview,
    getDataVersion: () => dataVersion,
    waitForSync,
  }
}

export function getWorkbenchRuntime(): Promise<WorkbenchRuntime> {
  if (!globalForRuntime.__moonNotesWorkbenchRuntime) {
    globalForRuntime.__moonNotesWorkbenchRuntime = createRuntime().catch(
      (error) => {
        globalForRuntime.__moonNotesWorkbenchRuntime = undefined
        throw error
      }
    )
  }
  return globalForRuntime.__moonNotesWorkbenchRuntime
}
