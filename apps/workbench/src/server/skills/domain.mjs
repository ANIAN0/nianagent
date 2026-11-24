import { SkillWorkbenchStore } from "./storage.mjs"
import { createSkillService } from "./service.mjs"
import { buildSharedTools } from "./tools.mjs"

export { SkillStoreError } from "./storage.mjs"

export async function openSkillDomain(directory, changed) {
  const store = new SkillWorkbenchStore(directory)
  await store.open()
  const service = createSkillService(store, { changed })
  const toolsByName = new Map(
    buildSharedTools(service).map((tool) => [tool.name, tool])
  )
  return { service, toolsByName }
}
