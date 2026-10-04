import { InputGroupTextarea } from "@/components/ui/input-group"
import type { Ref } from "react"
import { useComposerKeyboard } from "@/components/composer/composer-keymap"
export type PromptInputProps = {
  inputRef?: Ref<HTMLTextAreaElement>
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  variant?: "hero" | "docked"
  placeholder?: string
  ariaLabel?: string
}
/** Must be rendered inside InputGroup; parent owns submission validity. */
export function PromptInput({
  inputRef,
  value,
  onChange,
  onSubmit,
  variant = "hero",
  placeholder = "描述你要做的事…",
  ariaLabel = "描述你要做的事",
}: PromptInputProps) {
  const keyboard = useComposerKeyboard(onSubmit)
  return (
    <InputGroupTextarea
      ref={inputRef}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      data-composer-variant={variant}
      className="moon-composer-prompt"
      onChange={(event) => {
        onChange(event.target.value)
      }}
      {...keyboard}
    />
  )
}
