import { useId, useState, type ReactNode } from "react"
import { HomeStoryExample } from "./home-stories"
import {
  Check,
  ChevronDown,
  FileText,
  Plus,
  Search,
  X,
  TriangleAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCellDescription,
} from "@/components/ui/table"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"

export type BasicKind =
  | "button"
  | "checkbox"
  | "radio-group"
  | "select"
  | "switch"
  | "input"
  | "input-group"
  | "table"
  | "textarea"
  | "field"
  | "dropdown-menu"
  | "popover"
  | "dialog"
  | "tabs"
  | "tooltip"
  | "collapsible"
  | "badge"
  | "attachment"
  | "separator"
  | "alert"
  | "skeleton"
  | "empty"
export type BasicMode =
  | "normal"
  | "compact"
  | "disabled"
  | "invalid"
  | "long"
  | "processing"
  | "error"
  | "image-preview"
  | "reader"
  | "mixed"

/** Layout and controlled values only: every visible control comes from the shared implementation. */
export function BasicControlExample({
  kind,
  mode = "normal",
}: {
  kind: BasicKind
  mode?: BasicMode
}) {
  const id = useId()
  const [text, setText] = useState(
    mode === "long"
      ? "完整名称与较长内容用于检查边界，不能覆盖相邻操作。".repeat(
          kind === "textarea" ? 16 : 4
        )
      : ""
  )
  const [checked, setChecked] = useState(false)
  const [value, setValue] = useState("all")
  const [open, setOpen] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [event, setEvent] = useState("尚未操作")
  const disabled = mode === "disabled"
  const invalid = mode === "invalid"
  const label =
    mode === "long"
      ? "来自工作目录的完整名称与较长来源说明".repeat(3)
      : "演示选项"
  const selection = (next: string) => {
    setValue(next)
    setEvent(`选择：${next}`)
  }
  // These variants are demonstrated through their complete formal consumer;
  // the story supplies only isolated image/text data and host dependencies.
  if (
    (kind === "dialog" && (mode === "image-preview" || mode === "reader")) ||
    (kind === "attachment" && mode === "mixed")
  ) {
    return <HomeStoryExample scenario="preview-layout" />
  }
  const inputProps = {
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": invalid ? `${id}-error` : undefined,
    value: text,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      setText(e.target.value)
      setEvent(`输入：${e.target.value}`)
    },
  }
  let content: ReactNode
  switch (kind) {
    case "button":
      content = (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={disabled} onClick={() => setEvent("应用操作触发")}>
            应用
          </Button>
          <Button
            disabled={disabled}
            variant="outline"
            onClick={() => setEvent("取消操作触发")}
          >
            取消
          </Button>
          <Button
            disabled={disabled}
            variant="composer"
            size="composer"
            onClick={() => setEvent("配置入口触发")}
          >
            会话配置
            <ChevronDown />
          </Button>
          <Button
            disabled={disabled}
            variant="ghost"
            size="icon"
            aria-label="添加附件"
            onClick={() => setEvent("添加附件触发")}
          >
            <Plus />
          </Button>
        </div>
      )
      break
    case "checkbox":
      content = (
        <Field orientation="horizontal">
          <Checkbox
            id={id}
            disabled={disabled}
            checked={checked}
            onCheckedChange={(next) => {
              setChecked(next === true)
              setEvent(`勾选：${next}`)
            }}
          />
          <FieldLabel htmlFor={id}>读取文件</FieldLabel>
        </Field>
      )
      break
    case "radio-group":
      content = (
        <RadioGroup value={value} disabled={disabled} onValueChange={selection}>
          {[
            ["all", "全部项目指令"],
            ["directory", "当前目录指令"],
            ["none", "不使用项目指令"],
          ].map(([key, name]) => (
            <Field key={key} orientation="horizontal">
              <RadioGroupItem id={id + key} value={key} />
              <FieldLabel htmlFor={id + key}>{name}</FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      )
      break
    case "select":
      content = (
        <Field>
          <FieldLabel htmlFor={id}>工具来源</FieldLabel>
          <Select value={value} onValueChange={selection} disabled={disabled}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部来源</SelectItem>
                <SelectItem value="pi">Pi 内置工具</SelectItem>
                <SelectItem value="extension">扩展工具</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )
      break
    case "switch":
      content = (
        <Field orientation="horizontal">
          <Switch
            id={id}
            disabled={disabled}
            checked={checked}
            onCheckedChange={(next) => {
              setChecked(next)
              setEvent(`启用：${next}`)
            }}
          />
          <FieldLabel htmlFor={id}>启用演示扩展</FieldLabel>
        </Field>
      )
      break
    case "input":
      content = (
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={id}>搜索工具</FieldLabel>
          <Input
            {...inputProps}
            variant={mode === "compact" ? "compact" : "default"}
            placeholder="工具名称或用途"
          />
          {invalid && (
            <FieldError id={`${id}-error`}>请输入工具名称。</FieldError>
          )}
        </Field>
      )
      break
    case "input-group":
      content = (
        <Field>
          <FieldLabel htmlFor={id}>搜索工具</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              {...inputProps}
              variant={mode === "compact" ? "compact" : "default"}
              placeholder="搜索工具名称或用途"
            />
            {text && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="清除搜索"
                  onClick={() => {
                    setText("")
                    setEvent("搜索已清除")
                  }}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </Field>
      )
      break
    case "table":
      content = (
        <Table
          variant={mode === "compact" ? "compact" : "default"}
          className={mode === "compact" ? "table-fixed" : undefined}
          aria-label="工具表格示例"
        >
          <colgroup>
            <col className="w-11" />
            <col />
            <col className="w-28" />
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
            <TableRow>
              <TableCell className="text-center">
                <Checkbox
                  id={id}
                  checked={checked}
                  aria-label="读取文件"
                  onCheckedChange={(next) => {
                    setChecked(next === true)
                    setEvent(`勾选读取文件：${next}`)
                  }}
                />
              </TableCell>
              <TableCell>
                <label htmlFor={id} className="block cursor-pointer">
                  读取文件
                  <TableCellDescription>
                    读取文本与图片内容
                  </TableCellDescription>
                </label>
              </TableCell>
              <TableCell variant="secondary">Pi 内置工具</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="xs"
                  className="w-full"
                  onClick={() => setEvent("读取文件详情回调触发")}
                >
                  详情
                </Button>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-center">
                <Checkbox disabled aria-label="目录文件与文档内容检查工具" />
              </TableCell>
              <TableCell>
                {mode === "compact" || mode === "long"
                  ? "目录文件与文档内容检查工具的完整名称"
                  : "检查目录"}
                <TableCellDescription>
                  {mode === "compact" || mode === "long"
                    ? "示例环境缺少所需扩展依赖。较长原因按内容换行，不裁掉恢复需要的信息。"
                    : "示例环境缺少扩展依赖"}
                </TableCellDescription>
              </TableCell>
              <TableCell variant="secondary">
                {mode === "compact" || mode === "long"
                  ? "来自工作目录内的文档维护与内容检查扩展"
                  : "扩展工具"}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="xs"
                  className="w-full"
                  onClick={() => setEvent("检查目录详情回调触发")}
                >
                  详情
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )
      break
    case "textarea":
      content = (
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={id}>项目指令</FieldLabel>
          <Textarea
            {...inputProps}
            className="max-h-48"
            placeholder="输入项目指令"
          />
          {invalid && (
            <FieldError id={`${id}-error`}>项目指令不能为空。</FieldError>
          )}
        </Field>
      )
      break
    case "field":
      content = (
        <FieldGroup>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={id}>扩展名称</FieldLabel>
            <Input {...inputProps} />
            <FieldDescription>用于识别当前扩展。</FieldDescription>
            {invalid && (
              <FieldError id={`${id}-error`}>名称不能为空。</FieldError>
            )}
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id={id + "check"}
              checked={checked}
              onCheckedChange={(next) => setChecked(next === true)}
            />
            <FieldLabel htmlFor={id + "check"}>启用扩展</FieldLabel>
          </Field>
        </FieldGroup>
      )
      break
    case "dropdown-menu":
      content = (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={disabled}>
              选择工作目录
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => selection("moon")}>
                moon {value === "moon" && <Check />}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selection("notes")}>
                notes
              </DropdownMenuItem>
              <DropdownMenuItem disabled>不可用目录</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => setEvent("添加目录回调触发")}>
                添加目录
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      break
    case "popover":
      content = (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" disabled={disabled}>
              选择模型
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <Field>
              <FieldLabel htmlFor={id}>搜索模型</FieldLabel>
              <Input {...inputProps} />
            </Field>
            <div className="mt-3 flex flex-col gap-1">
              {["DeepSeek-V4-Flash", "Vision 示例"]
                .filter((name) =>
                  name.toLowerCase().includes(text.toLowerCase())
                )
                .map((name) => (
                  <Button
                    key={name}
                    variant="ghost"
                    className="justify-start"
                    onClick={() => {
                      selection(name)
                      setOpen(false)
                    }}
                  >
                    {name}
                  </Button>
                ))}
            </div>
          </PopoverContent>
        </Popover>
      )
      break
    case "dialog":
      content = (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">会话配置</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>会话配置</DialogTitle>
              <DialogDescription>更改当前示例的工具选择。</DialogDescription>
            </DialogHeader>
            <div className="max-h-64 overflow-y-auto">
              <Field orientation="horizontal">
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(next) => setChecked(next === true)}
                />
                <FieldLabel htmlFor={id}>读取文件</FieldLabel>
              </Field>
              {mode === "long" &&
                Array.from({ length: 16 }, (_, index) => (
                  <p key={index} className="mt-3">
                    说明 {index + 1}：长内容在弹窗正文滚动，操作仍可达。
                  </p>
                ))}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <Button
                onClick={() => {
                  setEvent(`应用：读取文件 ${checked}`)
                  setOpen(false)
                }}
              >
                应用
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )
      break
    case "tabs":
      content = (
        <Tabs defaultValue="tools" onValueChange={selection}>
          <TabsList aria-label="会话配置分类">
            <TabsTrigger value="tools">工具</TabsTrigger>
            <TabsTrigger value="instructions">项目指令</TabsTrigger>
            <TabsTrigger value="disabled" disabled>
              不可用
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tools">
            <p className="py-4">工具选择区域</p>
          </TabsContent>
          <TabsContent value="instructions">
            <p className="py-4">项目指令区域</p>
          </TabsContent>
        </Tabs>
      )
      break
    case "tooltip":
      content = (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="打开文件"
              onClick={() => setEvent("打开文件回调触发")}
            >
              <FileText />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {mode === "long"
              ? "docs/目录选择与材料准备的完整来源/首页输入区域的交互说明和不同状态验证步骤.md"
              : "docs/首页输入说明.md"}
          </TooltipContent>
        </Tooltip>
      )
      break
    case "collapsible":
      content = (
        <Collapsible
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            setEvent(`详情展开：${next}`)
          }}
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost">
              读取文件详情
              <ChevronDown />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 text-muted-foreground">
            读取工作目录内指定文件的文本或图片内容。
            {mode === "long" && "调用参数：path、offset、limit。".repeat(15)}
          </CollapsibleContent>
        </Collapsible>
      )
      break
    case "badge":
      content = (
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant="secondary"
            className="max-w-full break-words whitespace-normal"
          >
            {mode === "long" ? label : "Pi 内置工具"}
          </Badge>
          <Badge variant="outline">附件</Badge>
          <Badge variant="destructive">不可用</Badge>
        </div>
      )
      break
    case "attachment":
      content = removed ? (
        <Button
          variant="outline"
          onClick={() => {
            setRemoved(false)
            setEvent("示例附件恢复")
          }}
        >
          恢复示例
        </Button>
      ) : (
        <Attachment
          size="sm"
          state={
            mode === "error" && !recovered
              ? "error"
              : mode === "processing" && !recovered
                ? "processing"
                : "done"
          }
          className="w-80 max-w-full"
        >
          <AttachmentTrigger
            aria-label="预览附件"
            onClick={() => setEvent("附件预览回调触发")}
          />
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>
              {mode === "long" ? `${label}.md` : "首页说明.md"}
            </AttachmentTitle>
            <AttachmentDescription>
              {mode === "error" && !recovered
                ? "未能准备，请重试"
                : mode === "processing" && !recovered
                  ? "正在准备"
                  : "docs/首页说明.md"}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            {(mode === "error" || mode === "processing") && !recovered && (
              <AttachmentAction
                aria-label={mode === "error" ? "重试准备" : "完成准备"}
                onClick={() => {
                  setRecovered(true)
                  setEvent("准备完成")
                }}
              >
                <Check />
              </AttachmentAction>
            )}
            <AttachmentAction
              aria-label="移除附件"
              onClick={() => {
                setRemoved(true)
                setEvent("附件已移除")
              }}
            >
              <X />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      )
      break
    case "separator":
      content = (
        <div>
          <p>{mode === "long" ? label : "工具选择"}</p>
          <Separator className="my-4" />
          <div className="flex h-8 items-center gap-4">
            <span>取消</span>
            <Separator orientation="vertical" />
            <span>应用</span>
          </div>
        </div>
      )
      break
    case "alert":
      content = (
        <Alert variant={mode === "error" ? "destructive" : "default"}>
          <TriangleAlert />
          <AlertTitle>
            {mode === "error" ? "配置未能保存" : "目录不可用"}
          </AlertTitle>
          <AlertDescription>
            {mode === "error" ? "候选改动已保留。" : "请重新选择可用工作目录。"}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEvent("恢复操作触发")}
            >
              {mode === "error" ? "重试" : "选择目录"}
            </Button>
          </AlertDescription>
        </Alert>
      )
      break
    case "skeleton":
      content = recovered ? (
        <p>读取文件 · 编辑文件 · Bash 命令</p>
      ) : (
        <div aria-label="正在读取工具" role="status">
          <span className="sr-only">正在读取工具</span>
          <div className="max-h-48 space-y-3 overflow-auto">
            <Skeleton className="h-5 w-2/3" />
            {Array.from({ length: mode === "long" ? 8 : 2 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setRecovered(true)
              setEvent("读取完成")
            }}
          >
            完成读取
          </Button>
        </div>
      )
      break
    case "empty":
      content = (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>
              {mode === "error" ? "工具列表未能读取" : "没有匹配工具"}
            </EmptyTitle>
            <EmptyDescription>
              {mode === "error"
                ? "当前无法取得列表，可重新读取。"
                : "请调整名称或来源筛选。"}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() =>
                setEvent(mode === "error" ? "重新读取" : "筛选已清除")
              }
            >
              {mode === "error" ? "重新读取" : "清除筛选"}
            </Button>
          </EmptyContent>
        </Empty>
      )
      break
  }
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-6 p-6 text-[13px] leading-5">
      <div>{content}</div>
      <output
        className="border-t pt-3 break-words text-muted-foreground"
        aria-label="演示事件"
      >
        {event}
      </output>
    </main>
  )
}
