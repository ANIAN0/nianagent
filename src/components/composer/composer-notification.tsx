import { useEffect, useEffectEvent, type ReactNode } from "react"
import { Toaster, toast } from "sonner"
import "./composer-notification.css"

export function notifyComposer(
  message: string,
  options: {
    id?: string
    persistent?: boolean
    actions?: ReactNode
    anchor?: Element | null
  } = {}
) {
  const anchor =
    options.anchor ??
    Array.from(document.querySelectorAll(".moon-composer-input")).find(
      (element) => element.getBoundingClientRect().width > 0
    )
  if (anchor) {
    const rect = anchor.getBoundingClientRect()
    document.documentElement.style.setProperty(
      "--composer-toast-center",
      `${rect.left + rect.width / 2}px`
    )
  }
  return toast.custom(
    () => (
      <div className="moon-composer-toast" role="status">
        <span>{message}</span>
        {options.actions && (
          <div className="moon-composer-toast-actions">{options.actions}</div>
        )}
      </div>
    ),
    {
      id: options.id,
      duration: options.persistent ? Infinity : 3000,
      position: "top-center",
    }
  )
}
export function ComposerToaster() {
  return (
    <Toaster
      position="top-center"
      offset={40}
      visibleToasts={1}
      style={{
        left: "var(--composer-toast-center, 50%)",
        width: "min(480px, calc(100vw - 32px))",
      }}
    />
  )
}
export function ComposerNotification({
  message,
  persistent = false,
  actions,
}: {
  message: string
  persistent?: boolean
  actions?: ReactNode
}) {
  const show = useEffectEvent(() =>
    notifyComposer(message, { persistent, actions })
  )
  useEffect(() => {
    const id = show()
    return () => {
      toast.dismiss(id)
    }
  }, [message, persistent])
  return null
}
