import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Loader2, PlugZap } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  SettingsConfirmDialog,
  type SettingsConfirmation,
} from "@/features/models/settings-confirmation"
import type { LeaveGuard } from "@/features/models/connection-editor"
import { McpTransportFields } from "./mcp-transport-fields"
import { McpTestResult } from "./mcp-test-result"
import {
  blankMcpConfiguration,
  type McpConfiguration,
  type McpServer,
  type McpService,
  type McpTestResult as TestResult,
} from "./mcp-service"
export type McpServerEditorProps = {
  initial?: McpServer
  service: McpService
  cwd?: string
  onSaved(server: McpServer): void
  onClose(): void
  registerLeave?: (guard: LeaveGuard | null) => void
}
export function McpServerEditor({
  initial,
  service,
  cwd = "",
  onSaved,
  onClose,
  registerLeave,
}: McpServerEditorProps) {
  const [value, setValue] = useState<McpConfiguration>(() =>
    structuredClone(initial?.configuration || blankMcpConfiguration())
  )
  const [original] = useState(() =>
    JSON.stringify(initial?.configuration || blankMcpConfiguration())
  )
  const [result, setResult] = useState<TestResult | undefined>(initial?.test)
  const [tested, setTested] = useState(initial?.test ? original : "")
  const [busy, setBusy] = useState<"save" | "test">()
  const [error, setError] = useState("")
  const [confirm, setConfirm] = useState<SettingsConfirmation>()
  const controller = useRef<AbortController | null>(null)
  const validName = /^[a-zA-Z0-9_-]{1,64}$/.test(value.name)
  const validTimeout =
    Number.isSafeInteger(value.timeout) &&
    value.timeout >= 1 &&
    value.timeout <= 120
  const dirty = JSON.stringify(value) !== original
  const leave = useCallback<LeaveGuard>(
    (action) => {
      if (busy) {
        setError(
          busy === "save"
            ? "正在保存，请等待结果后离开。"
            : "请先取消连接测试后离开。"
        )
        return
      }
      if (!dirty) {
        action()
        return
      }
      setConfirm({
        title: "放弃未保存的配置？",
        description: "服务的已保存配置保持不变。",
        label: "放弃修改",
        action: async () => action(),
      })
    },
    [busy, dirty]
  )
  useEffect(() => {
    registerLeave?.(leave)
    return () => registerLeave?.(null)
  }, [registerLeave, leave])
  useEffect(() => () => controller.current?.abort(), [])
  const patch = (update: Partial<McpConfiguration>) => {
    setValue((old) => ({ ...old, ...update }))
    setError("")
  }
  async function request(kind: "save" | "test") {
    if (busy) return
    if (
      !validName ||
      !validTimeout ||
      (value.transport === "stdio" ? !value.command.trim() : !value.url.trim())
    ) {
      setError("请补全服务名称、连接参数和有效的超时时间。")
      return
    }
    const current = new AbortController()
    controller.current = current
    setBusy(kind)
    setError("")
    const captured = structuredClone(value)
    try {
      if (kind === "save") {
        const saved = await service.save(
          captured,
          initial?.revision,
          current.signal
        )
        if (!current.signal.aborted && controller.current === current)
          onSaved(saved)
      } else {
        const response = await service.test(captured, cwd, current.signal)
        if (!current.signal.aborted && controller.current === current) {
          setResult(response)
          setTested(JSON.stringify(captured))
        }
      }
    } catch (reason) {
      if (!current.signal.aborted && controller.current === current)
        setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (controller.current === current) {
        controller.current = null
        setBusy(undefined)
      }
    }
  }
  return (
    <section
      className="model-page mx-auto flex max-w-4xl flex-col gap-6"
      aria-label="MCP 服务配置"
    >
      <header className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="返回 MCP 服务"
          onClick={() => leave(onClose)}
        >
          <ArrowLeft />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">
            {initial ? initial.configuration.name : "添加 MCP 服务"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            填写连接参数，测试工具目录，再保存供会话选择。
          </p>
          {initial && (
            <p className="mt-2 text-xs break-all text-muted-foreground">
              个人配置 · {initial.source}
            </p>
          )}
        </div>
      </header>
      <FieldGroup>
        <Field data-invalid={!!value.name && !validName}>
          <FieldLabel htmlFor="mcp-name">服务名称</FieldLabel>
          <Input
            id="mcp-name"
            autoFocus
            value={value.name}
            disabled={!!busy || !!initial}
            aria-invalid={!!value.name && !validName}
            placeholder="如 filesystem、workspace_tools"
            onChange={(event) => patch({ name: event.target.value })}
          />
          <FieldDescription>
            使用字母、数字、下划线或横线，保存后作为稳定身份。
          </FieldDescription>
          {!!value.name && !validName && (
            <FieldError>名称限 1–64 个字母、数字、下划线或横线。</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="mcp-description">用途（可选）</FieldLabel>
          <Input
            id="mcp-description"
            value={value.description}
            disabled={!!busy}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder="如读取项目资料和搜索文档"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="mcp-transport">连接方式</FieldLabel>
          <Select
            value={value.transport}
            disabled={!!busy}
            onValueChange={(transport: McpConfiguration["transport"]) =>
              patch({ transport })
            }
          >
            <SelectTrigger id="mcp-transport">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="stdio">本地程序 · stdio</SelectItem>
                <SelectItem value="http">远程服务 · Streamable HTTP</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <McpTransportFields value={value} disabled={!!busy} onChange={patch} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={busy === "save" || !!busy}
            onClick={() => void request("test")}
          >
            {busy === "test" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <PlugZap />
            )}
            测试连接
          </Button>
          {busy === "test" && (
            <Button
              variant="ghost"
              onClick={() => {
                controller.current?.abort()
                setError("连接测试已取消，草稿保留。")
              }}
            >
              取消测试
            </Button>
          )}
        </div>
        <McpTestResult
          result={result}
          stale={!!result && tested !== JSON.stringify(value)}
        />
      </FieldGroup>
      <Separator />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="mcp-exposure">工具提供方式</FieldLabel>
          <Select
            value={value.exposure}
            disabled={!!busy}
            onValueChange={(exposure: McpConfiguration["exposure"]) =>
              patch({ exposure })
            }
          >
            <SelectTrigger id="mcp-exposure">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="codemode">按需组合调用（默认）</SelectItem>
                <SelectItem value="deferred">搜索后调用</SelectItem>
                <SelectItem value="direct">直接提供工具</SelectItem>
                <SelectItem value="hidden">隐藏所有工具</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            会话配置仍决定本次启用哪些工具；未选中的工具无法调用。
          </FieldDescription>
        </Field>
        <Field data-invalid={!validTimeout}>
          <FieldLabel htmlFor="mcp-timeout">请求超时（秒）</FieldLabel>
          <Input
            id="mcp-timeout"
            type="number"
            min={1}
            max={120}
            value={Number.isFinite(value.timeout) ? value.timeout : ""}
            disabled={!!busy}
            aria-invalid={!validTimeout}
            onChange={(event) => patch({ timeout: Number(event.target.value) })}
            className="max-w-40"
          />
          {!validTimeout && <FieldError>请输入 1–120 之间的整数。</FieldError>}
        </Field>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="mcp-enabled">启用服务</FieldLabel>
          <Switch
            id="mcp-enabled"
            checked={value.enabled}
            disabled={!!busy}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
        </Field>
      </FieldGroup>
      {error && (
        <Alert variant={error.includes("已取消") ? "default" : "destructive"}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <footer className="flex flex-wrap items-center gap-3 border-t pt-5">
        <Button
          disabled={!!busy || !validName || !validTimeout || !dirty}
          onClick={() => void request("save")}
        >
          {busy === "save" && <Loader2 className="animate-spin" />}保存服务
        </Button>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => leave(onClose)}
        >
          取消
        </Button>
        <p className="text-xs text-muted-foreground">
          保存后在会话配置中选择工具；当前运行继续使用本轮配置。
        </p>
      </footer>
      <SettingsConfirmDialog
        value={confirm}
        busy={false}
        error=""
        onConfirm={() => {
          const action = confirm?.action
          setConfirm(undefined)
          void action?.()
        }}
        onCancel={() => setConfirm(undefined)}
      />
    </section>
  )
}
