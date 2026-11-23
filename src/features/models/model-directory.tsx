import { useState, type ReactNode } from "react"
import { Ellipsis, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { DataTablePagination } from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableCellText,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ModelCheckState } from "./use-connection-editor"
import type { ModelDefinition } from "./model-types"
import { thinkingLevels, thinkingNames } from "./model-types"

function formatReasoning(model: ModelDefinition) {
  if (model.reasoning === undefined) return "待确认"
  if (!model.reasoning) return "—"
  const levels = thinkingLevels(model)
  return levels.length
    ? levels.map((level) => thinkingNames[level]).join(" / ")
    : "支持"
}

function formatInput(model: ModelDefinition) {
  return model.input
    .map((value) => (value === "text" ? "文本" : "图像"))
    .join("、")
}

function formatMetadataTooltip(model: ModelDefinition) {
  if (!model.metadata) return undefined
  const base =
    model.metadata.status === "unknown"
      ? "Pi 目录未匹配，请手动补全"
      : `Pi 目录匹配 · ${model.metadata.sources.length} 个来源`
  if (!model.metadata.conflicts.length) return base
  const conflictLabels = model.metadata.conflicts.map(
    (field) =>
      ({
        contextWindow: "上下文长度",
        maxTokens: "输出上限",
        reasoning: "思考能力",
        input: "输入类型",
        "compat.supportsDeveloperRole": "系统说明角色",
      })[field] ?? (field.startsWith("thinkingLevelMap") ? "思考等级" : field)
  )
  return `${base}；待确认：${conflictLabels.join("、")}`
}

export type ModelDirectoryProps = {
  readOnly?: boolean
  models: ModelDefinition[]
  busy?: boolean
  checks?: Record<string, ModelCheckState>
  toolbarAction?: ReactNode
  onEdit: (model: ModelDefinition) => void
  onRemove: (model: ModelDefinition) => void
  onCheck: (model: ModelDefinition) => void
  onConfigureConnection?: () => void
}

export function ModelDirectory({
  readOnly,
  models,
  busy,
  checks = {},
  toolbarAction,
  onEdit,
  onRemove,
  onCheck,
  onConfigureConnection,
}: ModelDirectoryProps) {
  const issueEntries = models
    .map((model) => ({ model, issue: checks[model.id]?.issue }))
    .filter(
      (
        entry
      ): entry is {
        model: ModelDefinition
        issue: NonNullable<ModelCheckState["issue"]>
      } => !!entry.issue
    )

  return (
    <div className="flex flex-col gap-3">
      {issueEntries.map(({ model, issue }) => (
        <OperationFeedback
          key={model.id}
          title={`${model.name} 检查未完成`}
          {...issue}
          actions={
            <RecoveryAction
              issue={issue}
              onRetry={() => onCheck(model)}
              onSettings={onConfigureConnection}
              disabled={busy}
              labels={{ retry: "重新检查", settings: "检查连接配置" }}
            />
          }
        />
      ))}
      <ModelTable
        models={models}
        label="模型"
        itemLabel="个模型"
        emptyTitle="此连接还没有模型"
        toolbarAction={toolbarAction}
        statusHeader="状态"
        renderStatus={(model) => {
          const check = checks[model.id]
          if (check?.issue) {
            return (
              <Badge variant="destructive" title={check.issue.message}>
                检查失败
              </Badge>
            )
          }
          if (check) {
            return (
              <Badge
                variant={check.error ? "destructive" : "secondary"}
                title={check.text}
              >
                {check.text}
              </Badge>
            )
          }
          if (model.metadata?.status === "unknown") {
            return (
              <Badge variant="outline" title={formatMetadataTooltip(model)}>
                待补全
              </Badge>
            )
          }
          if (model.metadata?.conflicts.length) {
            return (
              <Badge variant="outline" title={formatMetadataTooltip(model)}>
                待确认
              </Badge>
            )
          }
          return <span className="text-muted-foreground">—</span>
        }}
        renderActions={(model) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-8"
                disabled={busy}
                aria-label={`${model.name} 的操作`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={readOnly}
                  onSelect={() => onEdit(model)}
                >
                  <Pencil />
                  编辑模型
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCheck(model)}>
                  <Search />
                  {checks[model.id]?.issue?.code === "result_unknown"
                    ? "发起新检查"
                    : "检查可用性"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onRemove(model)}
                >
                  <Trash2 />
                  移除模型
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
    </div>
  )
}

export function DiscoveredModels({
  models,
  existing,
  busy,
  onAdd,
}: {
  models: ModelDefinition[]
  existing: ModelDefinition[]
  busy?: boolean
  onAdd: (models: ModelDefinition[]) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const existingIds = new Set(existing.map((model) => model.id))
  const addable = selected.filter((id) => !existingIds.has(id))

  return (
    <ModelTable
      models={models}
      label="候选模型"
      itemLabel="个候选模型"
      emptyTitle="没有发现模型"
      toolbarAction={
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={busy || !addable.length}
          onClick={() => {
            onAdd(models.filter((model) => addable.includes(model.id)))
            setSelected([])
          }}
        >
          <Plus data-icon="inline-start" />
          加入选中模型{addable.length ? `（${addable.length}）` : ""}
        </Button>
      }
      renderHeaderSelection={(pageItems) => {
        const selectable = pageItems.filter(
          (model) => !existingIds.has(model.id)
        )
        const selectedCount = selectable.filter((model) =>
          selected.includes(model.id)
        ).length
        const allSelected =
          selectable.length > 0 && selectedCount === selectable.length
        const someSelected =
          selectedCount > 0 && selectedCount < selectable.length

        return (
          <Checkbox
            aria-label="全选当前页候选模型"
            disabled={busy || selectable.length === 0}
            checked={allSelected || (someSelected && "indeterminate")}
            onCheckedChange={(checked) => {
              const ids = selectable.map((model) => model.id)
              setSelected((values) =>
                checked
                  ? [...new Set([...values, ...ids])]
                  : values.filter((value) => !ids.includes(value))
              )
            }}
          />
        )
      }}
      renderRowSelection={(model) => {
        const alreadyAdded = existingIds.has(model.id)
        return (
          <Checkbox
            aria-label={`选择 ${model.name}`}
            disabled={busy || alreadyAdded}
            checked={alreadyAdded || selected.includes(model.id)}
            onCheckedChange={(checked) =>
              setSelected((values) =>
                checked
                  ? [...values, model.id]
                  : values.filter((value) => value !== model.id)
              )
            }
          />
        )
      }}
      statusHeader="状态"
      renderStatus={(model) =>
        existingIds.has(model.id) ? (
          <Badge variant="secondary">已加入</Badge>
        ) : selected.includes(model.id) ? (
          <Badge variant="outline">待加入</Badge>
        ) : (
          <span className="text-muted-foreground">可加入</span>
        )
      }
    />
  )
}

function ModelTable({
  models,
  label,
  itemLabel,
  emptyTitle,
  toolbarAction,
  renderHeaderSelection,
  renderRowSelection,
  statusHeader,
  renderStatus,
  renderActions,
}: {
  models: ModelDefinition[]
  label: string
  itemLabel: string
  emptyTitle: string
  toolbarAction?: ReactNode
  renderHeaderSelection?: (pageItems: ModelDefinition[]) => ReactNode
  renderRowSelection?: (model: ModelDefinition) => ReactNode
  statusHeader?: string
  renderStatus?: (model: ModelDefinition) => ReactNode
  renderActions?: (model: ModelDefinition) => ReactNode
}) {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)

  const term = query.trim().toLowerCase()
  const filtered = term
    ? models.filter((model) =>
        `${model.id} ${model.name} ${model.api}`.toLowerCase().includes(term)
      )
    : models

  const totalPages = Math.max(1, Math.ceil(filtered.length / size))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * size, currentPage * size)

  return (
    <div className="flex flex-col gap-3">
      {(models.length > 0 || toolbarAction) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {models.length > 0 ? (
            <InputGroup className="h-8 w-full max-w-xs">
              <InputGroupAddon>
                <Search className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={`搜索${label}`}
                placeholder="按名称、ID 或接口筛选"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(1)
                }}
              />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="清空筛选"
                    onClick={() => {
                      setQuery("")
                      setPage(1)
                    }}
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          ) : (
            <div />
          )}
          {toolbarAction}
        </div>
      )}

      {pageItems.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table variant="compact">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {renderHeaderSelection && (
                  <TableHead className="w-[40px]">
                    {renderHeaderSelection(pageItems)}
                  </TableHead>
                )}
                <TableHead className="min-w-[140px]">名称</TableHead>
                <TableHead className="min-w-[160px]">模型 ID</TableHead>
                <TableHead className="w-[140px]">接口</TableHead>
                <TableHead className="w-[88px]">输入</TableHead>
                <TableHead className="w-[120px]">推理</TableHead>
                <TableHead className="w-[96px] text-right">上下文</TableHead>
                <TableHead className="w-[92px] text-right">最大输出</TableHead>
                {statusHeader && (
                  <TableHead className="w-[104px]">{statusHeader}</TableHead>
                )}
                {renderActions && (
                  <TableHead className="w-[60px] text-right">操作</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((model) => {
                const reasoningText = formatReasoning(model)
                const inputText = formatInput(model)
                return (
                  <TableRow key={model.id}>
                    {renderRowSelection && (
                      <TableCell className="align-middle">
                        {renderRowSelection(model)}
                      </TableCell>
                    )}
                    <TableCell className="max-w-[200px] align-middle font-medium text-foreground">
                      <TableCellText text={model.name} />
                    </TableCell>
                    <TableCell
                      variant="secondary"
                      className="max-w-[240px] align-middle font-mono"
                    >
                      <TableCellText text={model.id} />
                    </TableCell>
                    <TableCell className="align-middle whitespace-nowrap">
                      {model.api ? (
                        <Badge
                          variant="outline"
                          className="px-1.5 font-mono text-[11px] font-normal text-muted-foreground"
                        >
                          {model.api}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      variant="secondary"
                      className="max-w-[100px] align-middle"
                    >
                      <TableCellText text={inputText} />
                    </TableCell>
                    <TableCell
                      variant="secondary"
                      className="max-w-[140px] align-middle"
                    >
                      <TableCellText text={reasoningText} />
                    </TableCell>
                    <TableCell
                      variant="secondary"
                      className="text-right align-middle whitespace-nowrap tabular-nums"
                    >
                      {model.contextWindow?.toLocaleString() ?? "待补全"}
                    </TableCell>
                    <TableCell
                      variant="secondary"
                      className="text-right align-middle whitespace-nowrap tabular-nums"
                    >
                      {model.maxTokens?.toLocaleString() ?? "待补全"}
                    </TableCell>
                    {renderStatus && (
                      <TableCell className="align-middle whitespace-nowrap">
                        {renderStatus(model)}
                      </TableCell>
                    )}
                    {renderActions && (
                      <TableCell className="text-right align-middle whitespace-nowrap">
                        {renderActions(model)}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : models.length > 0 ? (
        <Empty className="rounded-lg border border-border py-10">
          <EmptyHeader>
            <EmptyTitle className="text-sm font-normal">
              未找到匹配的{label}
            </EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("")
                setPage(1)
              }}
            >
              清空筛选
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="rounded-lg border border-border py-10">
          <EmptyHeader>
            <EmptyTitle className="text-sm font-normal">
              {emptyTitle}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}

      {models.length > 0 && (
        <DataTablePagination
          total={models.length}
          filteredTotal={filtered.length}
          filtered={!!term}
          page={currentPage}
          pageSize={size}
          onPageChange={setPage}
          onPageSizeChange={setSize}
          itemLabel={itemLabel}
        />
      )}
    </div>
  )
}
