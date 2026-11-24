import { WorkbenchStore } from "./storage.mjs"
import { createV2Service } from "./service.mjs"

export async function openNotesDomain(directory, options) {
  const store = new WorkbenchStore(directory)
  await store.open()
  return { store, v2: createV2Service(store, options) }
}
