import {
  ComposerEditor,
  type ComposerEditorProps,
} from "@/components/composer/composer-editor"
export type PromptInputProps = Omit<
  ComposerEditorProps,
  "placeholder" | "ariaLabel" | "variant"
> &
  Partial<Pick<ComposerEditorProps, "placeholder" | "ariaLabel" | "variant">>
export function PromptInput({
  placeholder = "描述你想完成的工作，/ 选择命令或 Skill，@ 引用文件",
  ariaLabel = "描述你想完成的工作",
  variant = "hero",
  ...props
}: PromptInputProps) {
  return (
    <ComposerEditor
      {...props}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      variant={variant}
    />
  )
}
