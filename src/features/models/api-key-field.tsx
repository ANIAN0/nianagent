import { useEffect, useRef, useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { Eye, EyeOff, Copy, Check, LoaderCircle } from "lucide-react"
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field"

export function ApiKeyField({
  value,
  saved,
  disabled,
  error,
  onChange,
  onReveal,
  onReloadConnection,
}: {
  value: string
  saved: boolean
  disabled?: boolean
  error?: string
  onChange: (value: string) => void
  onReveal?: (signal: AbortSignal) => Promise<string>
  onReloadConnection?: () => void
}) {
  const [visible, setVisible] = useState(false)
  const [revealed, setRevealed] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [failure, setFailure] = useState<FeedbackDescription>()
  const [copyAction, setCopyAction] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      active.current?.abort()
      active.current = null
    },
    []
  )
  async function act(copy: boolean) {
    if (!copy && visible) {
      setVisible(false)
      setRevealed("")
      return
    }
    const controller = new AbortController()
    setCopyAction(copy)
    active.current?.abort()
    active.current = controller
    setBusy(true)
    setFailure(undefined)
    setNotice("")
    try {
      let secret = value || revealed
      if (!secret && saved) {
        if (!onReveal) throw new Error("当前服务无法读取密钥，请重新打开连接。")
        secret = await onReveal(controller.signal)
      }
      controller.signal.throwIfAborted()
      if (!secret) throw new Error("请先填写密钥。")
      if (copy) {
        await navigator.clipboard.writeText(secret)
        controller.signal.throwIfAborted()
        setNotice("已复制密钥")
      } else {
        setRevealed(secret)
        setVisible(true)
      }
    } catch (cause) {
      if (!controller.signal.aborted && active.current === controller)
        setFailure(
          feedbackFromError(
            cause,
            copy
              ? "未能复制密钥，请检查剪贴板权限后重试。"
              : "未能读取密钥，请重新打开连接后查看。"
          )
        )
    } finally {
      if (!controller.signal.aborted && active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }
  return (
    <Field data-invalid={!!(error || failure)}>
      <FieldLabel htmlFor="connection-key">API 密钥</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="connection-key"
          type={visible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || busy}
          placeholder={saved ? "••••••••••••••••" : "输入 API 密钥"}
          value={value || revealed}
          aria-invalid={!!(error || failure)}
          onChange={(e) => {
            setRevealed("")
            setNotice("")
            setFailure(undefined)
            onChange(e.target.value)
          }}
        />
        <InputGroupAddon align="inline-end" className="gap-1">
          <InputGroupButton
            type="button"
            size="icon-xs"
            disabled={disabled || busy || (!saved && !value)}
            aria-label={visible ? "隐藏密钥" : "显示密钥"}
            title={visible ? "隐藏密钥" : "显示密钥"}
            aria-pressed={visible}
            onClick={() => void act(false)}
          >
            {busy ? (
              <LoaderCircle className="animate-spin" />
            ) : visible ? (
              <EyeOff />
            ) : (
              <Eye />
            )}
          </InputGroupButton>
          <InputGroupButton
            type="button"
            size="icon-xs"
            disabled={disabled || busy || (!saved && !value)}
            aria-label="复制密钥"
            title="复制密钥"
            onClick={() => void act(true)}
          >
            {notice ? <Check /> : <Copy />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : failure ? (
        <OperationFeedback
          title={copyAction ? "未能复制密钥" : "未能读取密钥"}
          {...failure}
          actions={
            <RecoveryAction
              issue={failure}
              onRetry={() => void act(copyAction)}
              onReload={onReloadConnection}
              disabled={busy || disabled}
              labels={{
                retry: copyAction ? "重新复制" : "重新读取密钥",
                reload: "返回连接目录",
              }}
            />
          }
        />
      ) : (
        <FieldDescription role="status">
          {notice ||
            (saved
              ? "已保存。可显示、复制或直接输入新密钥。"
              : "密钥仅保存在本机。")}
        </FieldDescription>
      )}
    </Field>
  )
}
