import { useEffect, useRef, useState } from "react"
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
}: {
  value: string
  saved: boolean
  disabled?: boolean
  error?: string
  onChange: (value: string) => void
  onReveal?: (signal: AbortSignal) => Promise<string>
}) {
  const [visible, setVisible] = useState(false)
  const [revealed, setRevealed] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [failure, setFailure] = useState("")
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  async function act(copy: boolean) {
    if (!copy && visible) {
      setVisible(false)
      setRevealed("")
      return
    }
    const controller = new AbortController()
    active.current?.abort()
    active.current = controller
    setBusy(true)
    setFailure("")
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
      if (!controller.signal.aborted)
        setFailure(
          cause instanceof Error ? cause.message : "操作失败，请重试。"
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
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
      {error || failure ? (
        <FieldError>{error || failure}</FieldError>
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
