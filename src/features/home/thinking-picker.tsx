import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
export const thinkingOptions = ["低", "中等", "高", "极高"] as const
export type ThinkingPickerProps = {
  value: string
  onChange: (value: string) => void
}
export function ThinkingPicker({ value, onChange }: ThinkingPickerProps) {
  return (
    <RadioGroup
      aria-label="思考强度"
      value={value}
      onValueChange={onChange}
      className="gap-0"
    >
      {thinkingOptions.map((option) => (
        <label
          key={option}
          className="flex h-[38px] cursor-pointer items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent has-[:focus-visible]:bg-accent"
        >
          <span className="flex-1">{option}</span>
          <RadioGroupItem
            variant="check"
            value={option}
            onClick={() => {
              if (option === value) onChange(option)
            }}
          />
        </label>
      ))}
    </RadioGroup>
  )
}
