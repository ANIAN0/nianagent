import type { WorkbenchRuntime } from "../runtime"

export function openNotesDomain(
  directory: string,
  options: {
    event: () => void
    baseUrl: string
    logger: { append: () => void }
    changed: () => void
    openVersionUrl: (
      draftId: string,
      versionId: string,
      compareVersionId?: string
    ) => string
    inventory: { forVersion: (versionId: string) => unknown }
  }
): Promise<Pick<WorkbenchRuntime, "store" | "v2">>
