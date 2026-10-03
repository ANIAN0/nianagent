import { useEffect, useRef } from "react"
import { FileText } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { CopyButton } from "./copy-button"

export function ArchitectureViewer({
  content,
  module,
  sectionTitle,
  focusOnMount = false,
}: {
  content: string
  module: string
  sectionTitle?: string
  focusOnMount?: boolean
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) heading.current?.focus({ preventScroll: true })
  }, [focusOnMount, module])
  const sections = [...content.matchAll(/^## (.+)\r?$/gm)].map(
    (match, index, all) => ({
      title: match[1]!,
      content: content
        .slice(match.index, all[index + 1]?.index ?? content.length)
        .trim(),
    })
  )
  const normalize = (text: string) => text.replace(/[\s·]/g, "")
  const chapter = sections.find((section) =>
    normalize(section.title).includes(normalize(sectionTitle ?? module))
  )
  return (
    <section
      className="api-architecture-panel"
      aria-label={`${module}模块架构`}
    >
      <div className="api-panel-heading">
        <div className="api-response-heading">
          <FileText aria-hidden="true" />
          <h3 ref={heading} tabIndex={-1}>
            {module} · 模块说明
          </h3>
        </div>
      </div>
      <p className="api-response-note">
        来源 ARCHITECTURE.md · 数据归属、依赖与源码位置
      </p>
      <Tabs defaultValue="module" key={module}>
        <TabsList variant="line" aria-label="架构文档范围">
          <TabsTrigger value="module">当前模块</TabsTrigger>
          <TabsTrigger value="all">架构全文</TabsTrigger>
        </TabsList>
        <TabsContent value="module">
          {chapter ? (
            <>
              <div className="api-architecture-tools">
                <span>{chapter.title}</span>
                <CopyButton value={chapter.content} label="复制说明" />
              </div>
              <pre
                className="api-architecture-content moon-scrollbar"
                tabIndex={0}
              >
                {chapter.content}
              </pre>
            </>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>架构文档没有同名章节</EmptyTitle>
                <EmptyDescription>
                  请在“架构全文”中查看相关模块职责，内容直接读取现有架构文件。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="all">
          <div className="api-architecture-tools">
            <span>{sections.length} 个章节</span>
            <CopyButton value={content} label="复制全文" />
          </div>
          <pre className="api-architecture-content moon-scrollbar" tabIndex={0}>
            {content}
          </pre>
        </TabsContent>
      </Tabs>
    </section>
  )
}
