import { NotificationToaster } from "@/components/ui/notification-toast"
import { NotificationToastExample } from "../../../../ui-catalog/fixtures/notification-toast-example"

/** 预览环境：挂载 Toaster 宿主，让 notifyToast 在预览文档内可呈现。 */
export function NotificationToastEntry({ tone }: { tone?: string }) {
  return (
    <>
      <NotificationToaster />
      <NotificationToastExample
        tone={tone === "warning" || tone === "error" || tone === "success" ? tone : "info"}
      />
    </>
  )
}
