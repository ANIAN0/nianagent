import { ThemeProvider } from "@/components/theme-provider"
import { ComposerToaster } from "@/components/composer/composer-notification"
import { TooltipProvider } from "@/components/ui/tooltip"
import { HomeStoryExample } from "./fixtures/home-stories"

/** 预览环境：与目录预览宿主一致的 Provider 树，让首页演示在独立文档内完整运行。 */
export function HomeStoryEntry({ scenario }: { scenario?: string }) {
  return (
    <ThemeProvider defaultTheme="light" storageKey={null}>
      <TooltipProvider>
        <ComposerToaster />
        <HomeStoryExample
          scenario={
            scenario as Parameters<typeof HomeStoryExample>[0]["scenario"]
          }
        />
      </TooltipProvider>
    </ThemeProvider>
  )
}
