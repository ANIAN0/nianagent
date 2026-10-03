import { useState, useRef, useEffect } from "react"
import { Check, Copy, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

export function CopyButton({
  value,
  label = "复制",
  disabled = false,
}: {
  value: string
  label?: string
  disabled?: boolean
}) {
  return (
    <CopyAction key={value} value={value} label={label} disabled={disabled} />
  )
}

function CopyAction({
  value,
  label,
  disabled,
}: {
  value: string
  label: string
  disabled: boolean
}) {
  const [feedback, setFeedback] = useState<{
    value: string
    status: "copied" | "failed"
  } | null>(null)
  const state = feedback?.value === value ? feedback.status : "idle"
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )
  async function copy() {
    const id = ++generation.current
    try {
      await navigator.clipboard.writeText(value)
      if (generation.current === id) setFeedback({ value, status: "copied" })
    } catch {
      if (generation.current === id) setFeedback({ value, status: "failed" })
    }
  }
  return (
    <span className="api-copy-control">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void copy()}
        disabled={disabled || !value}
        aria-label={label}
      >
        {state === "copied" ? (
          <Check data-icon="inline-start" />
        ) : state === "failed" ? (
          <AlertCircle data-icon="inline-start" />
        ) : (
          <Copy data-icon="inline-start" />
        )}
        {state === "copied" ? "已复制" : label}
      </Button>
      <span className="api-copy-feedback" aria-live="polite">
        {state === "failed"
          ? "复制失败，请手动选择内容"
          : state === "copied"
            ? "复制成功"
            : ""}
      </span>
    </span>
  )
}
