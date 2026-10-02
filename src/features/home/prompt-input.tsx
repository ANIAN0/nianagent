import { InputGroupTextarea } from "@/components/ui/input-group"
export type PromptInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}
/** Must be rendered inside InputGroup; parent owns submission validity. */
export function PromptInput({ value, onChange, onSubmit }: PromptInputProps) {
  return (
    <InputGroupTextarea
      aria-label="描述你要做的事"
      placeholder="描述你要做的事…"
      value={value}
      className="max-h-[min(288px,40dvh)] min-h-[52px] px-3.5 pt-3 pb-0 text-[15px] leading-6"
      onChange={(event) => {
        onChange(event.target.value)
      }}
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault()
          onSubmit()
        }
      }}
    />
  )
}
