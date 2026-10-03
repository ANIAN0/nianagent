import { useRef, useState } from "react"
import { ChevronDown, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group"
import type { HomeTool } from "./home-types"
export type ToolPickerProps = {
  tools: HomeTool[]
  value: string[]
  onChange: (ids: string[]) => void
}
export function ToolPicker({ tools, value, onChange }: ToolPickerProps) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const detailButtons = useRef(new Map<string, HTMLButtonElement>())
  const matching = tools.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const groups = [...new Set(matching.map((tool) => tool.group))]
  function changeMany(ids: string[], checked: boolean) {
    onChange(
      checked
        ? [
            ...new Set([
              ...value,
              ...ids.filter(
                (id) =>
                  tools.find((tool) => tool.id === id)?.available !== false
              ),
            ]),
          ]
        : value.filter((id) => !ids.includes(id))
    )
  }
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault()
          event.stopPropagation()
          detailButtons.current.get(expanded)?.focus()
          setExpanded(null)
        }
      }}
    >
      <InputGroup className="h-9 shrink-0">
        <InputGroupAddon>
          <Search className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          autoFocus
          aria-label="搜索工具"
          placeholder="搜索工具名称或用途"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="清空工具搜索"
              onClick={() => setQuery("")}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query && (
          <p className="mb-2 text-xs text-muted-foreground">
            组操作会影响该来源的全部工具。
          </p>
        )}
        {groups.map((group) => {
          const all = tools.filter((tool) => tool.group === group)
          const available = all.filter((tool) => tool.available !== false)
          const selected = all.filter((tool) => value.includes(tool.id)).length
          return (
            <section
              key={group}
              className="mb-3 not-first:border-t not-first:pt-3 last:mb-0"
            >
              <div className="flex min-h-8 items-center gap-2 text-xs">
                <h3 className="font-medium">{group}</h3>
                <span className="text-muted-foreground">
                  {selected} / {all.length}
                </span>
                <div className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={available.every((tool) =>
                      value.includes(tool.id)
                    )}
                    aria-label={`${group}全选`}
                    onClick={() =>
                      changeMany(
                        all.map((tool) => tool.id),
                        true
                      )
                    }
                  >
                    全选
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={!selected}
                    aria-label={`${group}全不选`}
                    onClick={() =>
                      changeMany(
                        all.map((tool) => tool.id),
                        false
                      )
                    }
                  >
                    全不选
                  </Button>
                </div>
              </div>
              {matching
                .filter((tool) => tool.group === group)
                .map((tool) => (
                  <div key={tool.id}>
                    <div className="flex items-start gap-2.5 rounded-[10px] px-2 py-2 hover:bg-muted/50">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                        <Checkbox
                          className="mt-1"
                          checked={value.includes(tool.id)}
                          disabled={
                            tool.available === false && !value.includes(tool.id)
                          }
                          onCheckedChange={(checked) =>
                            changeMany([tool.id], checked === true)
                          }
                        />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="text-[13px] leading-5 font-medium">
                            {tool.name}
                          </span>
                          <span className="line-clamp-2 text-xs leading-[18px] text-muted-foreground">
                            {tool.description}
                          </span>
                          {tool.available === false && (
                            <span className="text-xs leading-[18px] text-destructive">
                              {tool.unavailableReason || "当前环境不可用"}
                            </span>
                          )}
                        </span>
                      </label>
                      <Button
                        ref={(node) => {
                          if (node) detailButtons.current.set(tool.id, node)
                          else detailButtons.current.delete(tool.id)
                        }}
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-7 gap-1 px-1 font-normal text-muted-foreground"
                        aria-label={`${tool.name}的详情`}
                        aria-expanded={expanded === tool.id}
                        aria-controls={`tool-detail-${tool.id}`}
                        onClick={() =>
                          setExpanded(expanded === tool.id ? null : tool.id)
                        }
                      >
                        详情
                        <ChevronDown
                          className={`size-3 ${expanded === tool.id ? "rotate-180" : ""}`}
                        />
                      </Button>
                    </div>
                    {expanded === tool.id && (
                      <div
                        id={`tool-detail-${tool.id}`}
                        role="region"
                        aria-label={`${tool.name}详情`}
                        className="mt-0.5 mr-2 mb-2.5 ml-6 border-l-2 px-2 py-1 text-xs text-muted-foreground"
                      >
                        <p className="text-[13px] leading-5 break-words whitespace-pre-wrap">
                          {tool.detail}
                        </p>
                        <dl className="mt-2 grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t pt-2">
                          <dt>来源</dt>
                          <dd>{tool.group}</dd>
                          <dt>工具名</dt>
                          <dd className="font-mono text-[11px] break-all">
                            {tool.id}
                          </dd>
                          {tool.path && (
                            <>
                              <dt>位置</dt>
                              <dd className="font-mono text-[11px] break-all">
                                {tool.path}
                              </dd>
                            </>
                          )}
                        </dl>
                      </div>
                    )}
                  </div>
                ))}
            </section>
          )
        })}
        {!matching.length && (
          <p
            role="status"
            className="py-12 text-center text-sm text-muted-foreground"
          >
            {tools.length ? "没有匹配的工具" : "暂无可用工具"}
          </p>
        )}
        {!!tools.length && !value.length && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            后续步骤不提供工具。
          </p>
        )}
      </div>
    </div>
  )
}
