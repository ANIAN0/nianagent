import { useState } from "react"
import { Ellipsis, Pencil, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { SettingsPagination } from "./settings-pagination"
import type { ModelDefinition } from "./model-types"
import { thinkingLevels, thinkingNames } from "./model-types"

export type ModelDirectoryProps = {
  readOnly?: boolean
  models: ModelDefinition[]
  busy?: boolean
  checks?: Record<string, { error?: boolean; text: string }>
  onEdit: (model: ModelDefinition) => void
  onRemove: (model: ModelDefinition) => void
  onCheck: (model: ModelDefinition) => void
}
export function ModelDirectory({
  readOnly,
  models,
  busy,
  checks = {},
  onEdit,
  onRemove,
  onCheck,
}: ModelDirectoryProps) {
  return (
    <ModelTable
      models={models}
      label="模型"
      empty="此连接还没有模型"
      description="先测试连接发现模型，或手工添加。空连接也可保存。"
      status={(model) =>
        checks[model.id] && (
          <span
            role={checks[model.id].error ? "alert" : "status"}
            className={
              checks[model.id].error
                ? "model-secondary text-destructive"
                : "model-secondary"
            }
          >
            {checks[model.id].text}
          </span>
        )
      }
      actions={(model) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
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
                检查可用性
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
  const addable = selected.filter(
    (id) => !existing.some((model) => model.id === id)
  )
  return (
    <>
      <ModelTable
        models={models}
        label="候选模型"
        empty="没有发现模型"
        description="可以手工添加服务支持的模型。"
        selection={(model) => (
          <Checkbox
            aria-label={`选择 ${model.name}`}
            disabled={busy || existing.some((item) => item.id === model.id)}
            checked={
              existing.some((item) => item.id === model.id) ||
              selected.includes(model.id)
            }
            onCheckedChange={(checked) =>
              setSelected((values) =>
                checked
                  ? [...values, model.id]
                  : values.filter((value) => value !== model.id)
              )
            }
          />
        )}
        actions={(model) => (
          <span className="text-xs text-muted-foreground">
            {existing.some((item) => item.id === model.id)
              ? "已加入"
              : selected.includes(model.id)
                ? "待加入"
                : "可加入"}
          </span>
        )}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !addable.length}
          onClick={() => {
            onAdd(models.filter((model) => addable.includes(model.id)))
            setSelected([])
          }}
        >
          加入选中模型{addable.length ? `（${addable.length}）` : ""}
        </Button>
      </div>
    </>
  )
}
import type { ReactNode } from "react"
function ModelTable({
  models,
  label,
  empty,
  description,
  status,
  selection,
  actions,
}: {
  models: ModelDefinition[]
  label: string
  empty: string
  description: string
  status?: (model: ModelDefinition) => ReactNode
  selection?: (model: ModelDefinition) => ReactNode
  actions: (model: ModelDefinition) => ReactNode
}) {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const filtered = models.filter((model) =>
    `${model.id} ${model.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / size))
  )
  return (
    <>
      {models.length > 0 && (
        <div className="model-toolbar model-toolbar-plain">
          <Input
            aria-label={`搜索${label}`}
            placeholder="搜索模型名称或 ID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
          />
          <span>
            {filtered.length} / {models.length} 个{label}
          </span>
        </div>
      )}
      {filtered.length ? (
        <div
          className="model-table-frame"
          role="region"
          tabIndex={0}
          aria-label={`${label}表格，可横向滚动`}
        >
          <Table className="model-table model-directory-table">
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead>接口与能力</TableHead>
                <TableHead>上下文 / 输出</TableHead>
                <TableHead>{selection ? "状态" : "操作"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered
                .slice((currentPage - 1) * size, currentPage * size)
                .map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <div className="flex items-start gap-2.5">
                        {selection?.(model)}
                        <div className="min-w-0">
                          <strong
                            className="model-technical"
                            title={model.name}
                          >
                            {model.name}
                          </strong>
                          <span className="model-secondary" title={model.id}>
                            {model.id}
                          </span>
                          {status?.(model)}
                          {model.metadata && (
                            <span
                              className="model-secondary"
                              title={model.metadata.sources.join("\n")}
                            >
                              {model.metadata.status === "unknown"
                                ? "Pi 目录未匹配，请手动补全"
                                : `Pi 目录匹配 · ${model.metadata.sources.length} 个来源`}
                              {!!model.metadata.conflicts.length &&
                                `；待确认：${model.metadata.conflicts.map((field) => ({ contextWindow: "上下文长度", maxTokens: "输出上限", reasoning: "思考能力", input: "输入类型" })[field] ?? (field.startsWith("thinkingLevelMap") ? "思考等级" : field)).join("、")}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="model-technical">{model.api}</span>
                      <span className="model-secondary">
                        {model.reasoning === undefined
                          ? "思考能力待确认"
                          : model.reasoning
                            ? "推理"
                            : "无推理"}{" "}
                        ·{" "}
                        {model.input
                          .map((value) => (value === "text" ? "文本" : "图像"))
                          .join("、")}
                      </span>
                      {model.reasoning && (
                        <span className="model-secondary">
                          思考等级：
                          {thinkingLevels(model)
                            .map((level) => thinkingNames[level])
                            .join(" / ") || "待确认"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {model.contextWindow?.toLocaleString() ?? "待补全"} /{" "}
                      {model.maxTokens?.toLocaleString() ?? "待补全"}
                    </TableCell>
                    <TableCell>{actions(model)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Empty className="model-empty">
          <EmptyHeader>
            <EmptyTitle>{query ? `没有匹配的${label}` : empty}</EmptyTitle>
            <EmptyDescription>
              {query ? "请修改搜索词。" : description}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {models.length > 0 && (
        <SettingsPagination
          total={filtered.length}
          page={currentPage}
          size={size}
          onPage={setPage}
          onSize={setSize}
          label={label}
        />
      )}
    </>
  )
}
