import { HoverHint } from "@/components/feedback/hover-hint"
import { useContext, useEffect, useId, useState } from "react"
import {
  ChevronDown,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/components/composer/composer-panel-context"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import type { ConversationPermission } from "@/contracts/rpc.generated"
import { PermissionServiceContext } from "./permission-service"
import "./permission-picker.css"
export const permissionModes = [
  {
    value: "read-only",
    label: "仅可查看",
    icon: ShieldCheck,
    description: "读取工作区文件；禁止修改与命令",
  },
  {
    value: "workspace",
    label: "工作区内修改",
    icon: ShieldHalf,
    description: "工作区文件可修改；命令、外部文件及扩展逐次审批",
  },
  {
    value: "full-access",
    label: "完全权限",
    icon: ShieldAlert,
    description: "允许本机文件、命令与网络访问",
  },
] as const
export function PermissionPicker({
  mode = "workspace",
  disabled,
  loading,
  saving,
  disabledReason = "当前操作完成后可修改会话权限。",
  onChange,
}: {
  mode?: ConversationPermission["mode"]
  disabled?: boolean
  loading?: boolean
  saving?: boolean
  disabledReason?: string
  onChange: (mode: ConversationPermission["mode"]) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [open, setOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const acknowledgeId = useId()
  const selected = permissionModes.find((item) => item.value === mode)!
  const busy = loading || saving
  const Icon = busy ? LoaderCircle : selected.icon
  const label = saving
    ? "正在保存权限…"
    : loading
      ? "读取权限…"
      : selected.label
  const accessibleLabel = saving
    ? "正在保存会话权限"
    : loading
      ? "正在读取会话权限"
      : `会话权限，当前为${selected.label}`
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <HoverHint
          content={
            busy ? undefined : disabled ? disabledReason : selected.label
          }
          disabled={disabled && !busy}
          suppressed={open}
          onlyWhenTruncated={disabled ? false : "[data-hint-label]"}
          label={accessibleLabel}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="composer"
              size="composer"
              className="moon-permission-trigger moon-composer-selector"
              type="button"
              disabled={disabled || busy}
              aria-label={accessibleLabel}
              aria-busy={busy || undefined}
            >
              <Icon
                data-icon="inline-start"
                className={busy ? "animate-spin" : undefined}
              />
              <span className="moon-permission-label" data-hint-label>
                {label}
              </span>
              <ChevronDown
                data-icon="inline-end"
                className="moon-permission-chevron"
              />
            </Button>
          </DropdownMenuTrigger>
        </HoverHint>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="moon-permission-menu"
        >
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => {
                const option = permissionModes.find(
                  (item) => item.value === value
                )
                if (!option || option.value === mode) return
                if (option.value === "full-access") {
                  setAcknowledged(false)
                  setConfirm(true)
                } else onChange(option.value)
              }}
            >
              {permissionModes.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  className="moon-permission-item"
                >
                  <item.icon aria-hidden="true" />
                  <span>{item.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>允许完全权限</DialogTitle>
            <DialogDescription>
              此会话的工具可访问工作区外文件、执行命令并连接网络，无需逐次审批。已启用的扩展同样拥有宿主进程权限。
            </DialogDescription>
          </DialogHeader>
          <Field orientation="horizontal">
            <Checkbox
              id={acknowledgeId}
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              disabled={disabled || busy}
            />
            <FieldLabel htmlFor={acknowledgeId}>我了解上述风险</FieldLabel>
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              取消
            </Button>
            <Button
              disabled={!acknowledged || disabled || busy}
              onClick={() => {
                setConfirm(false)
                onChange("full-access")
              }}
            >
              允许完全权限
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
export function SessionPermissionControl({
  sessionId,
  disabled,
  disabledReason,
}: {
  sessionId?: string
  disabled?: boolean
  disabledReason?: string
}) {
  const service = useContext(PermissionServiceContext)
  const [result, setResult] = useState<{
    key: string
    permission?: ConversationPermission
    issue?: FeedbackDescription
  }>()
  const [pending, setPending] = useState(false)
  const [revision, setRevision] = useState(0)
  const [errorOpen, setErrorOpen] = useComposerPanel("permission-error")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("permission-error")
  const key = `${sessionId}:${revision}`
  const current = result?.key === key ? result : undefined
  const permission = current?.permission
  const issue = current?.issue
  const reading = !current
  useEffect(() => {
    if (!service || !sessionId) return
    const controller = new AbortController()
    void service
      .read(sessionId, controller.signal)
      .then((permission) => {
        if (!controller.signal.aborted) setResult({ key, permission })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, issue: feedbackFromError(error) })
      })
    return () => controller.abort()
  }, [service, sessionId, key])
  if (!service || !sessionId) return null
  if (issue)
    return (
      <Popover open={errorOpen} onOpenChange={setErrorOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="composer"
            size="composer"
            className="moon-permission-trigger moon-composer-selector"
            disabled={disabled}
            aria-label={permission ? "会话权限待核对" : "会话权限未读取"}
          >
            <ShieldAlert data-icon="inline-start" />
            <span className="moon-permission-label">
              {permission ? "权限待核对" : "权限未读取"}
            </span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onCloseAutoFocus={closeAutoFocus}
          className="w-80 max-w-[calc(100vw-24px)] rounded-xl p-3"
          aria-label="会话权限恢复"
        >
          <OperationFeedback
            notify={false}
            density="compact"
            title="权限设置待核对"
            {...issue}
            actions={
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setErrorOpen(false)
                  setRevision((value) => value + 1)
                }}
              >
                重新读取权限
              </Button>
            }
          />
        </PopoverContent>
      </Popover>
    )
  return (
    <div className="relative">
      <PermissionPicker
        loading={reading}
        saving={pending}
        disabledReason={disabledReason}
        mode={permission?.mode}
        disabled={disabled || reading || pending || !permission || !!issue}
        onChange={(mode) => {
          if (!permission) return
          setPending(true)
          void service
            .set(permission, mode)
            .then((permission) => setResult({ key, permission }))
            .catch((error) =>
              setResult({ key, permission, issue: feedbackFromError(error) })
            )
            .finally(() => setPending(false))
        }}
      />
    </div>
  )
}
