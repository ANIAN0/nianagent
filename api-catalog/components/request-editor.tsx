import { useId } from "react"
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  Info,
  LoaderCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { CopyButton } from "./copy-button"
import type { ModelOperation } from "./types"

export function RequestEditor({
  operation,
  title,
  value,
  onChange,
  onRestoreExample,
  onClear,
  busy,
  validationError,
  dirty,
  onRun,
  onCancel,
  environment,
  effect,
  blockedReason,
}: {
  operation: ModelOperation
  title: string
  value: string
  onChange: (value: string) => void
  onRestoreExample: () => void
  onClear: () => void
  busy: boolean
  validationError: string | null
  dirty: boolean
  onRun: () => void
  onCancel: () => void
  environment: string
  effect: string
  blockedReason?: string
}) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const canRun = !busy && !validationError && !blockedReason
  return (
    <section className="api-request-panel" aria-label={`${title}调用面板`}>
      <div className="api-panel-heading">
        <h3>真实调用</h3>
        <span>JSON 参数</span>
      </div>
      <div className="api-call-target">
        <span>调用目标</span>
        <strong>{environment}</strong>
        <code>{operation}</code>
      </div>
      <Alert className="api-call-effect">
        <Info />
        <AlertTitle>此操作将调用当前 Moon 服务</AlertTitle>
        <AlertDescription>{effect}</AlertDescription>
      </Alert>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (canRun) onRun()
        }}
      >
        <FieldGroup>
          <Field data-invalid={!!validationError} data-disabled={busy}>
            <div className="api-editor-label">
              <FieldLabel htmlFor={inputId}>请求参数</FieldLabel>
              <span>{dirty ? "已修改" : "示例参数"}</span>
            </div>
            <div className="api-editor-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={onRestoreExample}
              >
                <RotateCcw data-icon="inline-start" />
                恢复示例
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={onClear}
              >
                <Trash2 data-icon="inline-start" />
                清空输入
              </Button>
              <CopyButton value={value} label="复制参数" disabled={busy} />
            </div>
            <Textarea
              id={inputId}
              className="api-json-editor moon-scrollbar"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              disabled={busy}
              aria-invalid={!!validationError}
              aria-describedby={
                validationError ? `${errorId} ${hintId}` : hintId
              }
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              rows={10}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault()
                  if (canRun) onRun()
                }
              }}
            />
            {validationError && (
              <p id={errorId} className="api-validation-error" role="status">
                {validationError}
              </p>
            )}
            <FieldDescription id={hintId}>
              参数需符合接口契约；示例标识和目录需替换为当前有效值。
            </FieldDescription>
          </Field>
        </FieldGroup>
        {blockedReason && (
          <p role="status" className="text-sm text-muted-foreground">
            {blockedReason}
          </p>
        )}
        <div className="api-run-actions">
          <Button type="submit" disabled={!canRun}>
            {busy ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {busy ? "调用中…" : "执行真实调用"}
          </Button>
          {busy && (
            <Button type="button" variant="outline" onClick={onCancel}>
              <Square data-icon="inline-start" />
              取消等待
            </Button>
          )}
          <span className="api-run-shortcut">Ctrl / ⌘ + Enter</span>
        </div>
        <p className="api-cancel-note">
          取消只结束当前等待；请核对原操作，已提交的数据变化不会回滚。
        </p>
      </form>
    </section>
  )
}
