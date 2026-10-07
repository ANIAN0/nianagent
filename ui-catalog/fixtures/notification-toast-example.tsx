import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { notifyToast, type NotificationTone } from "@/components/ui/notification-toast"

export function NotificationToastExample({ tone }: { tone: NotificationTone }) {
  const anchor = useRef<HTMLDivElement>(null)
  const message = tone === "warning"
    ? "发送结果待确认，原消息和下一稿已保留。请核对原请求，不要重复发送。"
    : tone === "error"
      ? "配置未能保存，候选改动已保留。"
      : "会话配置已应用。"
  return (
    <div ref={anchor}>
      <Button onClick={() => notifyToast(message, { tone, anchor: anchor.current })}>显示提示</Button>
    </div>
  )
}
