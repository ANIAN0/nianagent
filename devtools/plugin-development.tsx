import { PluginDevelopmentPage } from "@/features/plugin-development/plugin-development-page"
import { mountTool } from "./tool-root"
import { navigateTool, useToolSearch } from "./location"

function PluginDevelopmentDocument() {
  const search = useToolSearch()
  return (
    <PluginDevelopmentPage
      header={false}
      section={new URLSearchParams(search).get("section") ?? undefined}
      onSectionChange={(section) => {
        const params = new URLSearchParams(search)
        params.set("section", section)
        navigateTool(`${location.pathname}?${params}`)
      }}
    />
  )
}

mountTool("插件开发", <PluginDevelopmentDocument />)
