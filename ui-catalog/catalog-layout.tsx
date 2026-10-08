import type { ReactNode } from "react"
import { ArrowUpRight } from "lucide-react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** Owns only shell/panel presentation, so previews can inject isolated content. */
export function CatalogLayout({
  narrow,
  panel,
  onPanelChange,
  navigation,
  preview,
  docs,
}: {
  narrow: boolean
  panel: string
  onPanelChange: (panel: string) => void
  navigation: ReactNode
  preview: ReactNode
  docs: ReactNode
}) {
  return (
    <div className="catalog-app">
      <header className="catalog-header">
        <a href="/ui-catalog/" className="catalog-brand">
          <strong>moon</strong>
          <span>组件库</span>
        </a>
        <div className="catalog-header-links">
          <a href="/">
            工作台 <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
      </header>
      {narrow ? (
        <Tabs
          value={panel}
          onValueChange={onPanelChange}
          className="catalog-mobile-tabs"
        >
          <div className="catalog-mobile-toolbar">
            <TabsList aria-label="组件库面板">
              <TabsTrigger value="tree">目录</TabsTrigger>
              <TabsTrigger value="preview">组件</TabsTrigger>
              <TabsTrigger value="docs">结构信息</TabsTrigger>
            </TabsList>
          </div>
          <div className="catalog-mobile">
            <TabsContent
              value="tree"
              forceMount
              hidden={panel !== "tree"}
              className="catalog-mobile-panel"
            >
              {navigation}
            </TabsContent>
            <TabsContent
              value="preview"
              forceMount
              hidden={panel !== "preview"}
              className="catalog-mobile-panel"
            >
              {preview}
            </TabsContent>
            <TabsContent
              value="docs"
              forceMount
              hidden={panel !== "docs"}
              className="catalog-mobile-panel"
            >
              {docs}
            </TabsContent>
          </div>
        </Tabs>
      ) : (
        <div className="catalog-desktop">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="18%" minSize="15%">
              {navigation}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="52%" minSize="30%">
              {preview}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="30%" minSize="22%">
              {docs}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </div>
  )
}
