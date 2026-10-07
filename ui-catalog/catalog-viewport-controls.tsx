import { useState } from "react"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  parseViewportDimension,
  viewportLimits,
  type ViewportAxis,
} from "./catalog-controls"

function DimensionInput({
  label,
  value,
  axis,
  onCommit,
}: {
  label: string
  value: number
  axis: ViewportAxis
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState({
    base: value,
    text: String(value),
    error: "",
  })
  const text = draft.base === value ? draft.text : String(value)
  const error = draft.base === value ? draft.error : ""
  const id = label === "宽" ? "catalog-width" : "catalog-height"
  function commit() {
    const next = parseViewportDimension(text, axis)
    const { minimum, maximum } = viewportLimits[axis]
    if (next === null) {
      setDraft({
        base: value,
        text,
        error: `${label}度需为 ${minimum}–${maximum} 的整数`,
      })
      return
    }
    setDraft({ base: next, text: String(next), error: "" })
    onCommit(next)
  }
  return (
    <Field
      orientation="horizontal"
      className="catalog-dimension"
      data-invalid={!!error}
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="numeric"
        value={text}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) =>
          setDraft({ base: value, text: event.target.value, error: "" })
        }
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
          }
          if (event.key === "Escape")
            setDraft({ base: value, text: String(value), error: "" })
        }}
      />
      {error && (
        <p className="catalog-input-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </Field>
  )
}

export function CatalogViewportControls({
  width,
  height,
  defaultViewport,
  onChange,
}: {
  width: number
  height: number
  defaultViewport: { width: number; height: number }
  onChange: (width: number, height: number) => void
}) {
  const presets = [
    { id: "default", name: "组件默认", ...defaultViewport },
    { id: "desktop", name: "桌面", width: 1280, height: 800 },
    { id: "tablet", name: "平板", width: 768, height: 1024 },
    { id: "phone", name: "手机", width: 390, height: 844 },
  ]
  const selected =
    presets.find((preset) => preset.width === width && preset.height === height)
      ?.id ?? "custom"
  return (
    <FieldGroup className="catalog-viewport-controls">
      <Field orientation="horizontal" className="catalog-preset">
        <FieldLabel htmlFor="catalog-viewport-preset" className="sr-only">
          视口预设
        </FieldLabel>
        <Select
          value={selected}
          onValueChange={(id) => {
            const preset = presets.find((item) => item.id === id)
            if (preset) onChange(preset.width, preset.height)
          }}
        >
          <SelectTrigger id="catalog-viewport-preset" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name} · {preset.width} × {preset.height}
                </SelectItem>
              ))}
              <SelectItem value="custom" disabled>
                自定义尺寸
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <div className="catalog-dimensions">
        <DimensionInput
          label="宽"
          value={width}
          axis="width"
          onCommit={(next) => onChange(next, height)}
        />
        <span className="catalog-dimension-separator" aria-hidden="true">
          ×
        </span>
        <DimensionInput
          label="高"
          value={height}
          axis="height"
          onCommit={(next) => onChange(width, next)}
        />
        <span className="catalog-viewport-unit">px</span>
      </div>
    </FieldGroup>
  )
}
