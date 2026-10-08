import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react"
import { ArrowLeft, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCellDescription,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ComposerTool } from "@/lib/composer/types"

/** All rows use the same column axes; long content can increase row height. */
function ToolOptionRow({
  tool,
  checked,
  onChange,
  onDetail,
  detailRef,
}: {
  tool: ComposerTool
  checked: boolean
  onChange: (checked: boolean) => void
  onDetail: () => void
  detailRef: (node: HTMLButtonElement | null) => void
}) {
  const checkboxId = useId()
  const unavailable = tool.available === false
  return (
    <TableRow
      data-tool-row
      data-unavailable={unavailable || undefined}
      className="data-[unavailable=true]:text-muted-foreground"
    >
      <TableCell className="text-center">
        <div className="flex justify-center">
          <Checkbox
            id={checkboxId}
            aria-label={tool.name}
            checked={checked}
            disabled={unavailable && !checked}
            onCheckedChange={(value) => onChange(value === true)}
          />
        </div>
      </TableCell>
      <TableCell>
        <label
          htmlFor={checkboxId}
          className={`block min-w-0 break-all ${unavailable && !checked ? "cursor-default" : "cursor-pointer"}`}
        >
          <span className="font-medium">{tool.name}</span>
          <TableCellDescription className="mt-0.5">
            {unavailable
              ? tool.unavailableReason || "当前环境不可用"
              : tool.description}
          </TableCellDescription>
        </label>
      </TableCell>
      <TableCell variant="secondary" className="break-all">
        {tool.group}
      </TableCell>
      <TableCell>
        <div className="flex">
          <Button
            ref={detailRef}
            type="button"
            variant="ghost"
            size="xs"
            className="w-full"
            aria-label={`${tool.name}的详情`}
            onClick={onDetail}
          >
            详情
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export type ToolPickerHandle = {
  backIfDetail: () => boolean
}
export type ToolPickerProps = {
  ref?: Ref<ToolPickerHandle>
  canRestoreFocus?: boolean
  tools: ComposerTool[]
  value: string[]
  onChange: (ids: string[]) => void
}
export function ToolPicker({
  ref,
  canRestoreFocus = true,
  tools,
  value,
  onChange,
}: ToolPickerProps) {
  const [query, setQuery] = useState("")
  const [source, setSource] = useState("all")
  const [detailId, setDetailId] = useState<string>()
  const detail = tools.find((tool) => tool.id === detailId)
  // Reset removed identities during render so the same id cannot revive a
  // closed detail later. Focus restoration itself stays in the layout effect.
  if (detailId && !detail) setDetailId(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const previousDetailId = useRef<string | undefined>(undefined)
  const pendingFocus = useRef<
    { view: "detail" } | { view: "list"; id: string } | null
  >(null)
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
    setDetailId(undefined)
  }
  useImperativeHandle(ref, () => ({
    backIfDetail() {
      if (!detail) return false
      back()
      return true
    },
  }))
  useLayoutEffect(() => {
    const previous = previousDetailId.current
    previousDetailId.current = detailId
    if (detailId && previous !== detailId)
      pendingFocus.current = { view: "detail" }
    else if (previous && !detailId)
      pendingFocus.current = { view: "list", id: previous }

    // Extension/catalog transitions can hide or disable the picker while a
    // tool disappears. Keep the request until its actual controls are usable.
    const restoration = pendingFocus.current
    if (!canRestoreFocus || !restoration) return
    const target =
      restoration.view === "detail"
        ? backButton.current
        : (detailButtons.current.get(restoration.id) ?? search.current)
    if (!target || target.disabled) return
    if (restoration.view === "list" && scroll.current)
      scroll.current.scrollTop = listPosition.current
    target.focus({ preventScroll: true })
    if (target.ownerDocument.activeElement === target)
      pendingFocus.current = null
  }, [detailId, canRestoreFocus])
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 [--moon-tool-scroll-gutter:8px]"
      onKeyDownCapture={(event) => {
        if (event.defaultPrevented) return
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
            ref={backButton}
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={back}
          >
            <ArrowLeft data-icon="inline-start" />
            返回工具列表
          </Button>
          <div className="moon-scrollbar min-h-0 flex-1 overflow-auto px-1">
            <h3 className="text-sm font-medium break-all">{detail.name}</h3>
            <Badge
              variant="secondary"
              className="mt-2 max-w-full break-all whitespace-normal"
            >
              {detail.group}
            </Badge>
            <p className="mt-4 text-[13px] leading-6 break-words whitespace-pre-wrap">
              {detail.detail || detail.description}
            </p>
            {detail.available === false && (
              <p className="mt-3 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                {detail.unavailableReason ||
                  "当前环境不可用；已选工具可取消选择。"}
              </p>
            )}
            <dl className="mt-5 grid grid-cols-[56px_minmax(0,1fr)] gap-3 border-t pt-4 text-xs text-muted-foreground">
              <dt>工具标识</dt>
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
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                ref={search}
                variant="compact"
                className="h-full min-w-0"
                aria-label="搜索工具"
                placeholder="搜索工具名称或用途"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="清除工具搜索"
                    onClick={() => {
                      setQuery("")
                      search.current?.focus()
                    }}
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger
                size="default"
                className="w-32 min-w-0 shrink-0 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:overflow-hidden"
                aria-label="工具来源"
              >
                <SelectValue>
                  <span className="block max-w-full min-w-0 truncate whitespace-nowrap">
                    {source === "all" ? "全部来源" : source}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="end"
                className="w-64 max-w-[calc(100vw-32px)]"
              >
                <SelectGroup>
                  <SelectItem value="all">全部来源</SelectItem>
                  {[...new Set(tools.map((tool) => tool.group))].map(
                    (group) => (
                      <SelectItem
                        value={group}
                        key={group}
                        className="min-w-0 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
                      >
                        <span className="min-w-0 break-all whitespace-normal">
                          {group}
                        </span>
                      </SelectItem>
                    )
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex shrink-0 items-center gap-2 pr-[var(--moon-tool-scroll-gutter)] text-xs text-muted-foreground">
            <span>
              当前结果 {matching.length} · 总已选 {value.length}
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
            className="moon-scrollbar min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
          >
            <Table
              variant="compact"
              className="table-fixed"
              aria-label="会话工具"
            >
              <colgroup>
                <col className="w-11" />
                <col />
                <col className="w-[clamp(80px,18vw,112px)]" />
                <col className="w-14" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">选择</TableHead>
                  <TableHead>工具与用途</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead className="text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matching.map((tool) => (
                  <ToolOptionRow
                    key={tool.id}
                    tool={tool}
                    checked={value.includes(tool.id)}
                    onChange={(checked) => changeMany(checked, [tool])}
                    detailRef={(node) => {
                      if (node) detailButtons.current.set(tool.id, node)
                      else detailButtons.current.delete(tool.id)
                    }}
                    onDetail={() => {
                      listPosition.current = scroll.current?.scrollTop ?? 0
                      setDetailId(tool.id)
                    }}
                  />
                ))}
                {!matching.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      <p role="status" className="py-9 text-muted-foreground">
                        {tools.length ? "没有匹配的工具" : "暂无可用工具"}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
