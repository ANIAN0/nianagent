import { useEffect, useEffectEvent, useRef, type ReactNode } from "react"
import { CheckCircle, TriangleAlert } from "lucide-react"
import { Toaster, toast } from "sonner"
import "./notification-toast.css"

export type NotificationTone = "info" | "warning" | "error" | "success"
export type NotificationOptions = {
  id?: string
  tone?: NotificationTone
  error?: boolean
  actions?: ReactNode
  anchor?: Element | null
  persistent?: boolean
}
let activeAnchor: Element | null = null
function positionToast() {
  const rect = activeAnchor?.isConnected
    ? activeAnchor.getBoundingClientRect()
    : undefined
  document.documentElement.style.setProperty(
    "--moon-toast-center",
    rect?.width ? `${rect.left + rect.width / 2}px` : "50%"
  )
}
/**
 * Shared DSH-style notification; operation owners retain recovery controls.
 * 必须在已挂载 NotificationToaster 的入口内调用，否则静默无效果。
 */
export function notifyToast(
  message: string,
  options: NotificationOptions = {}
) {
  activeAnchor =
    options.anchor ??
    Array.from(document.querySelectorAll(".moon-composer-input")).find(
      (element) => element.getBoundingClientRect().width > 0
    ) ??
    null
  positionToast()
  const tone = options.tone ?? (options.error ? "error" : "info")
  return toast.custom(
    () => (
      <div
        className="moon-notification-toast"
        data-tone={tone}
        data-persistent={options.persistent ? "true" : "false"}
        role={tone === "error" || tone === "warning" ? "alert" : "status"}
      >
        {tone !== "info" &&
          (tone === "success" ? (
            <CheckCircle className="moon-notification-toast-icon" aria-hidden />
          ) : (
            <TriangleAlert
              className="moon-notification-toast-icon"
              aria-hidden
            />
          ))}
        <div className="moon-notification-toast-copy">
          {message}
          {options.actions && (
            <div className="moon-notification-toast-actions">
              {options.actions}
            </div>
          )}
        </div>
      </div>
    ),
    {
      id: options.id,
      duration: options.persistent ? Infinity : 4000,
      position: "top-center",
      style: {
        width: "100%",
        pointerEvents: options.actions ? "auto" : "none",
      },
    }
  )
}
export function NotificationToaster() {
  useEffect(() => {
    window.addEventListener("resize", positionToast)
    return () => window.removeEventListener("resize", positionToast)
  }, [])
  return (
    <Toaster
      position="top-center"
      offset={40}
      mobileOffset={40}
      visibleToasts={1}
      style={{
        left: "var(--moon-toast-center, 50%)",
        width: "min(640px, calc(100vw - 48px))",
        fontFamily: "inherit",
      }}
    />
  )
}
/** trigger 需传稳定引用（如 useCallback/useRef 或稳定 props），仅用于控制重播时机；每次渲染新建值会导致重复提示。 */
export function NotificationToast({
  message,
  trigger,
  id,
  tone = "info",
  error = false,
  persistent = false,
  actions,
  anchor,
}: NotificationOptions & { message: string; trigger?: unknown }) {
  const owner = useRef<HTMLSpanElement>(null)
  const show = useEffectEvent(() =>
    notifyToast(message, {
      id,
      tone: error ? "error" : tone,
      persistent,
      actions,
      anchor:
        anchor ??
        owner.current?.closest('[role="dialog"], .moon-composer-input'),
    })
  )
  useEffect(() => {
    const id = show()
    return () => {
      toast.dismiss(id)
    }
  }, [message, id, tone, error, persistent, trigger])
  return <span ref={owner} hidden />
}
