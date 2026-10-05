import { useRef, useState } from "react"
import { ArrowLeft, ChevronRight, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { HomeTool } from "./home-types"

export type ToolPickerProps = {
  tools: HomeTool[]
  value: string[]
  onChange: (ids: string[]) => void
}
export function ToolPicker({ tools, value, onChange }: ToolPickerProps) {
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("all")
  const [detail, setDetail] = useState<HomeTool>()
  const scroll = useRef<HTMLDivElement>(null)
  const listPosition = useRef(0)
  const detailButtons = useRef(new Map<string, HTMLButtonElement>())
  const matching = tools.filter(
    (tool) =>
      (source === "all" || tool.group === source) &&
      `${tool.name} ${tool.description} ${tool.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  )
  function changeMany(checked: boolean, items = matching) {
    const ids = items.map((tool) => tool.id)
    onChange(
      checked
        ? [
            ...new Set([
              ...value,
              ...items
                .filter((tool) => tool.available !== false)
                .map((tool) => tool.id),
            ]),
          ]
        : value.filter((id) => !ids.includes(id))
    )
  }
  function back() {
    const id = detail?.id
    setDetail(undefined)
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = listPosition.current
      if (id) detailButtons.current.get(id)?.focus()
    })
  }
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && detail) {
          event.preventDefault()
          event.stopPropagation()
          back()
        }
      }}
    >
      {detail ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={back}
          >
            <ArrowLeft />
            返回工具列表
          </Button>
          <div className="moon-scrollbar min-h-0 flex-1 overflow-auto px-1">
            <h3 className="text-sm font-medium">{detail.name}</h3>
            <Badge variant="secondary" className="mt-2">
              {detail.group}
            </Badge>
            <p className="mt-4 text-[13px] leading-6 whitespace-pre-wrap">
              {detail.detail || detail.description}
            </p>
            {detail.available === false && (
              <p className="mt-3 text-xs text-destructive">
                {detail.unavailableReason ||
                  "当前环境不可用；已选工具可取消选择。"}
              </p>
            )}
            <dl className="mt-5 grid grid-cols-[56px_minmax(0,1fr)] gap-3 border-t pt-4 text-xs text-muted-foreground">
              <dt>工具名</dt>
              <dd className="font-mono break-all">{detail.id}</dd>
              {detail.path && (
                <>
                  <dt>位置</dt>
                  <dd className="break-all">{detail.path}</dd>
                </>
              )}
            </dl>
          </div>
        </>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2">
            <InputGroup className="min-w-0 flex-1">
              <InputGroupAddon>
                <Search className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                className="h-full min-w-0"
                aria-label="搜索工具"
                placeholder="搜索工具名称或用途"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger
                size="default"
                className="w-32 shrink-0"
                aria-label="工具来源"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectGroup>
                  <SelectItem value="all">全部来源</SelectItem>
                  {[...new Set(tools.map((tool) => tool.group))].map(
                    (group) => (
                      <SelectItem value={group} key={group}>
                        {group}
                      </SelectItem>
                    )
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <span>
              当前结果 {matching.length} · 已选{" "}
              {matching.filter((tool) => value.includes(tool.id)).length}
            </span>
            <div className="ml-auto flex gap-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={
                  !matching.some(
                    (tool) =>
                      tool.available !== false && !value.includes(tool.id)
                  )
                }
                onClick={() => changeMany(true)}
              >
                全选
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={!matching.some((tool) => value.includes(tool.id))}
                onClick={() => changeMany(false)}
              >
                全不选
              </Button>
            </div>
          </div>
          <div
            ref={scroll}
            className="moon-scrollbar -mr-2 min-h-0 flex-1 [scrollbar-gutter:stable] overflow-auto"
          >
            {matching.map((tool) => (
              <div
                key={tool.id}
                className="flex items-center gap-3 rounded-lg py-2 hover:bg-accent/50"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={value.includes(tool.id)}
                    disabled={
                      tool.available === false && !value.includes(tool.id)
                    }
                    onCheckedChange={(checked) =>
                      changeMany(checked === true, [tool])
                    }
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-[13px] leading-5 font-medium">
                      {tool.name}
                      <Badge
                        variant="secondary"
                        className="px-1.5 text-[10px] font-normal"
                      >
                        {tool.group}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-xs leading-[18px] text-muted-foreground">
                      {tool.description}
                    </span>
                    {tool.available === false && (
                      <span className="block text-xs leading-[18px] text-destructive">
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
                  className="h-7 shrink-0 gap-1 font-normal text-muted-foreground"
                  aria-label={`${tool.name}的详情`}
                  onClick={() => {
                    listPosition.current = scroll.current?.scrollTop ?? 0
                    setDetail(tool)
                  }}
                >
                  详情
                  <ChevronRight className="size-3" />
                </Button>
              </div>
            ))}
            {!matching.length && (
              <p
                role="status"
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {tools.length ? "没有匹配的工具" : "暂无可用工具"}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
