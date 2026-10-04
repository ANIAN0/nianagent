import type { ResultRendererProps } from "@/features/extensions/result-renderers"

/** Development example. The host supplies actual status, copying and original parameters. */
export default function NoteResult({ payload }: ResultRendererProps) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("title" in payload) ||
    !("text" in payload) ||
    typeof payload.title !== "string" ||
    typeof payload.text !== "string"
  )
    throw new Error("Unsupported note result")
  return (
    <article
      className="rounded-lg border border-border bg-card px-3 py-2.5"
      aria-label="扩展记录结果"
    >
      <h4 className="text-sm font-medium">{payload.title}</h4>
      <p className="mt-1 text-sm leading-6 wrap-break-word whitespace-pre-wrap">
        {payload.text}
      </p>
    </article>
  )
}
