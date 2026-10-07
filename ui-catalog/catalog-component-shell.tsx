import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { storySectionName, type StorySection } from "./catalog-sections"

export function CatalogComponentShell({ section }: { section?: StorySection }) {
  return (
    <div className="catalog-component-shell" aria-label="组件空壳">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {section ? `${storySectionName(section)}待填充` : "内容待填充"}
          </EmptyTitle>
          <EmptyDescription>
            目录与组件结构确认后，再补充标准、状态和交互。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
