import { navigatePicker, PickerOption } from "./picker-option"
export const thinkingOptions = ["低", "中等", "高", "极高"] as const
export type ThinkingPickerProps = {
  value: string
  options?: readonly string[]
  onChange: (value: string) => void
}
export function ThinkingPicker({
  value,
  onChange,
  options = thinkingOptions,
}: ThinkingPickerProps) {
  return (
    <div
      role="menu"
      aria-label="思考强度"
      onKeyDown={navigatePicker}
      className="flex min-w-0 flex-col"
    >
      {options.map((option) => (
        <PickerOption
          key={option}
          selected={option === value}
          onSelect={() => onChange(option)}
        >
          {option}
        </PickerOption>
      ))}
    </div>
  )
}
