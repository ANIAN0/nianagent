import { useMcpEditor } from "./use-mcp-editor"
import { ArrowLeft, Loader2, PlugZap } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
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
import { Switch } from "@/components/ui/switch"
import { SettingsConfirmDialog } from "@/components/operations/settings-confirmation"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { McpTransportFields } from "./mcp-transport-fields"
import { McpTestResult } from "./mcp-test-result"
import {
  type McpConfiguration,
  type McpServer,
  type McpService,
} from "./mcp-service"
export type McpServerEditorProps = {
  initial?: McpServer
  service: McpService
  cwd?: string
  onSaved(server: McpServer, keepOpen?: boolean): void
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
  const {
    value,
    persisted,
    validName,
    validTimeout,
    validation,
    patch,
    dirty,
    busy,
    waitingToLeave,
    testNotice,
    testFailure,
    result,
    tested,
    saveFailure,
    recoverStorage,
    saveUnknown,
    saveConflict,
    saveBlocked,
    testBlocked,
    saveNotice,
    request,
    checkSaved,
    cancelTest,
    leave,
    confirm,
    setConfirm,
  } = useMcpEditor({ initial, service, cwd, onSaved, onClose, registerLeave })
  return (
    <div className="model-editor">
      <div className="model-scroll">
        <div className="model-page mx-auto max-w-4xl">
          <Button
            variant="ghost"
            size="icon-sm"
            className="model-back"
            aria-label="返回 MCP 服务"
            onClick={() => leave(onClose)}
          >
            <ArrowLeft />
          </Button>
          <header className="model-editor-head">
            <div>
              <h2>{persisted ? value.name : "添加 MCP 服务"}</h2>
              <p>
                {persisted
                  ? `个人配置 · ${initial?.source ?? ""}`
                  : "连接本地程序或远程服务，测试后供会话选择。"}
              </p>
            </div>
          </header>
          <div className="model-form">
            <section
              className="model-section"
              aria-labelledby="mcp-connection-heading"
            >
              <div className="model-section-head">
                <h3 id="mcp-connection-heading">连接</h3>
              </div>
              <FieldGroup>
                <Field data-invalid={!validName && (!!value.name || validation)}>
                  <FieldLabel htmlFor="mcp-name">服务名称</FieldLabel>
                  <Input
                    id="mcp-name"
                    autoFocus
                    value={value.name}
                    disabled={!!busy || persisted}
                    aria-invalid={!validName && (!!value.name || validation)}
                    placeholder="如 filesystem、workspace_tools"
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                  {!persisted && (
                    <FieldDescription>
                      使用字母、数字、下划线或横线，保存后作为稳定身份。
                    </FieldDescription>
                  )}
                  {!validName && (!!value.name || validation) && (
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
                        <SelectItem value="http">
                          远程服务 · Streamable HTTP
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <McpTransportFields
                  value={value}
                  disabled={!!busy}
                  validate={validation}
                  onChange={patch}
                />
              </FieldGroup>
            </section>
            <section
              className="model-section"
              aria-labelledby="mcp-test-heading"
            >
              <div className="model-section-head">
                <div>
                  <h3 id="mcp-test-heading">连接测试</h3>
                  <p>检查协议与工具目录；测试不会执行工具。</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={!!busy || saveUnknown || saveConflict || testBlocked}
                  onClick={() => void request("test")}
                >
                  {busy === "test" ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <PlugZap data-icon="inline-start" />
                  )}
                  {busy === "test" ? "正在测试…" : "测试连接"}
                </Button>
                {busy === "test" && (
                  <Button variant="ghost" onClick={cancelTest}>
                    取消测试
                  </Button>
                )}
                {busy === "test" && waitingToLeave && (
                  <p role="status" className="text-xs text-muted-foreground">
                    请先取消连接测试，再返回服务目录。
                  </p>
                )}
              </div>
              {testNotice && (
                <OperationFeedback
                  title="测试已取消"
                  message={testNotice}
                  severity="info"
                />
              )}
              {testFailure && (
                <OperationFeedback
                  title={
                    tested !== JSON.stringify(value)
                      ? "上次连接测试未完成"
                      : "未能完成连接测试"
                  }
                  message={testFailure.message}
                  details={testFailure.details}
                  severity={testFailure.severity}
                  actions={
                    <RecoveryAction
                      issue={testFailure}
                      onRetry={() => void request("test")}
                      onReload={() => void request("test")}
                      onSettings={() =>
                        document
                          .getElementById(
                            value.transport === "stdio" ? "mcp-command" : "mcp-url"
                          )
                          ?.focus()
                      }
                      disabled={!!busy || saveUnknown || saveConflict}
                      labels={{ retry: "重新测试" }}
                    />
                  }
                />
              )}
              <McpTestResult
                demo={service.evidence === "demo"}
                result={result}
                stale={!!result && tested !== JSON.stringify(value)}
                busy={!!busy || saveUnknown || saveConflict}
                onRetry={() => void request("test")}
              />
            </section>
            <section
              className="model-section"
              aria-labelledby="mcp-session-heading"
            >
              <div className="model-section-head">
                <div>
                  <h3 id="mcp-session-heading">会话提供</h3>
                  <p>会话配置决定本次调用哪些工具；未选中的工具无法调用。</p>
                </div>
              </div>
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
                        <SelectItem value="codemode">
                          按需组合调用（默认）
                        </SelectItem>
                        <SelectItem value="deferred">搜索后调用</SelectItem>
                        <SelectItem value="direct">直接提供工具</SelectItem>
                        <SelectItem value="hidden">隐藏所有工具</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
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
                    onChange={(event) =>
                      patch({ timeout: Number(event.target.value) })
                    }
                    className="max-w-40"
                  />
                  {!validTimeout && (
                    <FieldError>请输入 1–120 之间的整数。</FieldError>
                  )}
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
            </section>
          </div>
        </div>
      </div>
      {saveFailure && (
        <div className="flex-none px-8 pt-4">
          <OperationFeedback
            notify={false}
            title={
              saveUnknown
                ? "保存结果待确认"
                : saveFailure.code === "cancelled"
                  ? "保存已取消"
                  : "未能保存服务"
            }
            message={saveFailure.message}
            details={saveFailure.details}
            severity={saveUnknown ? "warning" : saveFailure.severity}
            actions={
              <>
                {saveFailure.code === "recovery_storage_unavailable" ? (
                  <Button variant="outline" size="sm" onClick={recoverStorage}>
                    重新读取本机恢复记录
                  </Button>
                ) : (
                  <RecoveryAction
                    issue={saveFailure}
                    onCheck={() => void checkSaved()}
                    onReload={() => leave(onClose)}
                    onRetry={() => void request("save")}
                    disabled={!!busy}
                    labels={{
                      check: "核对保存结果",
                      reload: "返回服务目录",
                      retry: "重新保存",
                    }}
                  />
                )}
              </>
            }
          />
        </div>
      )}
      {saveNotice && dirty && (
        <div className="flex-none px-8 pt-4">
          <OperationFeedback
            title="上次保存已确认"
            message={saveNotice}
            severity="info"
          />
        </div>
      )}
      <footer className="model-footer">
        <p
          role={busy === "save" || busy === "check" ? "status" : undefined}
        >
          {busy === "save"
            ? waitingToLeave
              ? "正在保存，请等待结果后离开。"
              : "正在保存服务配置，请稍候…"
            : busy === "check"
              ? "正在读取原保存回执，不会重复提交。"
              : saveUnknown
                ? "原保存结果仍待核对，当前草稿已保留。"
                : dirty
                  ? "有未保存的修改。"
                  : "保存后在会话配置中选择工具；当前运行继续使用本轮配置。"}
        </p>
        <div>
          <Button variant="outline" disabled={!!busy} onClick={() => leave(onClose)}>
            取消
          </Button>
          <Button
            disabled={
              !!busy ||
              saveUnknown ||
              saveConflict ||
              saveBlocked ||
              !validName ||
              !validTimeout ||
              !dirty
            }
            onClick={() => void request("save")}
          >
            {(busy === "save" || busy === "check") && (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            )}
            {busy === "save"
              ? "正在保存…"
              : busy === "check"
                ? "正在核对…"
                : "保存服务"}
          </Button>
        </div>
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
    </div>
  )
}
