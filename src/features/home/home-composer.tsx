import { useState } from "react"
import {
  ArrowUp,
  ChevronDown,
  FileText,
  Folder,
  Plus,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { materials, models, workspaces, type Material } from "./mock-data"

export function HomeComposer() {
  const [workspace, setWorkspace] = useState(workspaces[0]!)
  const [text, setText] = useState("")
  const [model, setModel] = useState(models[0]!)
  const [thinking, setThinking] = useState("标准思考")
  const [selected, setSelected] = useState<Material[]>([])
  const [configOpen, setConfigOpen] = useState(false)
  const [toolsEnabled, setToolsEnabled] = useState(true)
  const [result, setResult] = useState("")
  function submit() {
    if (!text.trim()) return
    setResult(
      `模拟提交已完成：${workspace.name} · ${model} · ${thinking} · ${selected.length} 项材料 · 工具${toolsEnabled ? "开启" : "关闭"}。未调用模型或执行任务。`
    )
  }
  return (
    <section
      className="mx-auto w-full max-w-[880px] px-5 pb-8 sm:px-8"
      aria-label="新建工作"
    >
      <h1 className="mb-8 text-center text-[26px] font-medium tracking-tight">
        开始一项工作
      </h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="mb-2 max-w-full text-muted-foreground"
            title={workspace.path}
          >
            <Folder data-icon="inline-start" />
            <span className="truncate">{workspace.name}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>选择工作目录 · 模拟</DropdownMenuLabel>
          <DropdownMenuGroup>
            {workspaces.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => {
                  setWorkspace(item)
                  setResult("")
                }}
              >
                <Folder />
                <div>
                  <div>
                    {item.name}
                    {workspace.id === item.id ? " ✓" : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.path}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <InputGroup className="rounded-2xl bg-background shadow-sm has-disabled:bg-background has-disabled:opacity-100">
          <InputGroupTextarea
            autoFocus
            aria-label="描述你要做的事"
            placeholder="描述你要做的事…"
            value={text}
            className="max-h-[40dvh] min-h-28 px-4 pt-4 text-[15px] leading-6"
            onChange={(event) => {
              setText(event.target.value)
              setResult("")
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault()
                submit()
              }
            }}
          />
          {selected.length > 0 && (
            <InputGroupAddon
              align="block-start"
              className="flex-wrap px-4 pt-3"
            >
              {selected.map((item) => (
                <Badge
                  variant="secondary"
                  key={item.id}
                  className="max-w-full gap-1 py-1"
                >
                  {item.kind === "Skill" ? <Sparkles /> : <FileText />}
                  <span className="truncate">{item.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`移除${item.name}`}
                    onClick={() => {
                      setSelected((items) =>
                        items.filter((entry) => entry.id !== item.id)
                      )
                      setResult("")
                    }}
                  >
                    <X />
                  </Button>
                </Badge>
              ))}
            </InputGroupAddon>
          )}
          <InputGroupAddon align="block-end" className="flex-wrap gap-1 p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton size="icon-sm" aria-label="添加附件或 Skill">
                  <Plus />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>添加模拟材料</DropdownMenuLabel>
                <DropdownMenuGroup>
                  {materials.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      disabled={selected.some((entry) => entry.id === item.id)}
                      onSelect={() => {
                        setSelected((items) => [...items, item])
                        setResult("")
                      }}
                    >
                      {item.kind === "Skill" ? <Sparkles /> : <FileText />}
                      {item.name}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {item.kind}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <p className="max-w-64 px-2 py-1 text-xs text-muted-foreground">
                  仅使用演示材料，不读取本地文件。
                </p>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
              <Select
                value={model}
                onValueChange={(value) => {
                  setModel(value)
                  setResult("")
                }}
              >
                <SelectTrigger
                  aria-label="选择模型"
                  size="sm"
                  className="border-0 shadow-none"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {models.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select
                value={thinking}
                onValueChange={(value) => {
                  setThinking(value)
                  setResult("")
                }}
              >
                <SelectTrigger
                  aria-label="思考强度"
                  size="sm"
                  className="border-0 shadow-none"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {["快速响应", "标准思考", "深入思考"].map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <InputGroupButton
                size="icon-sm"
                aria-label="会话配置"
                onClick={() => setConfigOpen(true)}
              >
                <SlidersHorizontal />
              </InputGroupButton>
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                className="rounded-full"
                aria-label="发送"
                disabled={!text.trim()}
              >
                <ArrowUp />
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="mt-3 flex flex-wrap justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>模拟模式 · 仅前端演示</span>
        <span>Enter 发送 · Shift + Enter 换行</span>
      </div>
      <p
        role="status"
        className="mt-4 min-h-10 text-sm leading-6 text-muted-foreground"
      >
        {result}
      </p>
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>会话配置</DialogTitle>
            <DialogDescription>
              配置仅影响本次模拟提交，不会执行任何工具。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-4 py-4">
            <Label htmlFor="tools-enabled">允许使用工具</Label>
            <Switch
              id="tools-enabled"
              checked={toolsEnabled}
              onCheckedChange={(value) => {
                setToolsEnabled(value)
                setResult("")
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
