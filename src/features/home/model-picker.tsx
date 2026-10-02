import { useRef, useState } from "react"
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ThinkingPicker } from "./thinking-picker"

export type ModelPickerProps = {
  models: string[]
  value: string
  thinking: string
  onChange: (value: string) => void
  onThinkingChange: (value: string) => void
}
export function ModelPicker({
  models,
  value,
  thinking,
  onChange,
  onThinkingChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<"root" | "model" | "thinking">("root")
  const rootButton = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  function show(next: typeof pane) {
    setPane(next)
    requestAnimationFrame(() =>
      (next === "root" ? rootButton : backButton).current?.focus()
    )
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setPane("root")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          disabled={!models.length}
          variant="ghost"
          size="sm"
          className="max-w-[min(220px,45cqw)] min-w-0 gap-1 rounded-full font-normal"
          aria-label={`选择模型，当前为 ${value || "无可用模型"} · ${thinking}`}
          title={`${value} · ${thinking}`}
        >
          <span className="truncate">{value || "无可用模型"}</span>
          <span className="shrink-0 text-muted-foreground">{thinking}</span>
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-60 rounded-xl p-1.5"
        aria-label="模型与思考"
        onEscapeKeyDown={(event) => {
          if (pane !== "root") {
            event.preventDefault()
            show("root")
          }
        }}
      >
        {pane === "root" ? (
          <div className="flex flex-col">
            <Button
              ref={rootButton}
              type="button"
              variant="ghost"
              className="h-10 justify-start font-normal"
              onClick={() => show("model")}
            >
              <span>模型</span>
              <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                {value}
              </span>
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-10 justify-start font-normal"
              onClick={() => show("thinking")}
            >
              <span>思考强度</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {thinking}
              </span>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <Button
              ref={backButton}
              type="button"
              variant="ghost"
              className="mb-1 h-8 w-full justify-start text-xs text-muted-foreground"
              onClick={() => show("root")}
            >
              <ArrowLeft className="size-3.5" />
              {pane === "model" ? "模型" : "思考强度"}
            </Button>
            {pane === "model" ? (
              <RadioGroup
                aria-label="可用模型"
                value={value}
                className="max-h-64 gap-0 overflow-y-auto"
                onValueChange={(model) => {
                  onChange(model)
                  setOpen(false)
                }}
              >
                {models.map((model) => (
                  <label
                    key={model}
                    className="flex h-[38px] cursor-pointer items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent has-[:focus-visible]:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate" title={model}>
                      {model}
                    </span>
                    <RadioGroupItem
                      variant="check"
                      value={model}
                      onClick={() => {
                        if (model === value) setOpen(false)
                      }}
                    />
                  </label>
                ))}
              </RadioGroup>
            ) : (
              <ThinkingPicker
                value={thinking}
                onChange={(next) => {
                  onThinkingChange(next)
                  setOpen(false)
                }}
              />
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
