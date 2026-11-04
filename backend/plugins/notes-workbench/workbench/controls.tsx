import type { ArgType, PageDetail, PageState } from "./types"

type Values = Record<string, string | number | boolean | null>

const numberValue = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

function Control({
  definition,
  value,
  onChange,
}: {
  definition: ArgType
  value: string | number | boolean | null | undefined
  onChange: (value: string | number | boolean | null) => void
}) {
  const label = definition.label || definition.name
  if (definition.control === "boolean")
    return (
      <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
        <span className="text-[12px] text-neutral-300" title={definition.description || label}>
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value === true}
          className={`relative h-4.5 w-8 shrink-0 rounded-full transition-colors ${
            value === true ? "bg-[#0d99ff]" : "bg-[#4a4a4a]"
          }`}
          onClick={() => onChange(value !== true)}
        >
          <span
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${
              value === true ? "left-4" : "left-0.5"
            }`}
          />
        </button>
      </label>
    )
  if (definition.control === "number")
    return (
      <label className="block py-1">
        <span className="flex items-center justify-between text-[12px] text-neutral-300">
          <span title={definition.description || label}>{label}</span>
          <span className="font-mono text-[11px] text-neutral-500">
            {numberValue(value)}
          </span>
        </span>
        <input
          type="range"
          min={definition.min ?? 0}
          max={definition.max ?? 100}
          step="any"
          value={numberValue(value, definition.min ?? 0)}
          onChange={(event) => onChange(Number(event.target.value))}
          className="mt-1 w-full accent-[#0d99ff]"
        />
      </label>
    )
  if (definition.control === "select")
    return (
      <label className="flex items-center justify-between gap-3 py-1">
        <span className="min-w-0 shrink-0 text-[12px] text-neutral-300" title={definition.description || label}>
          {label}
        </span>
        <select
          value={typeof value === "string" ? value : definition.options[0] ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 max-w-40 flex-1 rounded bg-[#383838] px-1.5 py-1 text-[12px] text-neutral-200 outline-none focus:ring-1 focus:ring-[#0d99ff]"
        >
          {definition.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    )
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0 shrink-0 text-[12px] text-neutral-300" title={definition.description || label}>
        {label}
      </span>
      <input
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className="min-w-0 max-w-40 flex-1 rounded bg-[#383838] px-1.5 py-1 text-[12px] text-neutral-200 outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0d99ff]"
      />
    </label>
  )
}

export function Controls({
  detail,
  state,
  onArgsChange,
}: {
  detail: PageDetail
  state: PageState | null
  onArgsChange: (stateId: string, values: Values) => void
}) {
  const argTypes = detail.page.meta?.argTypes ?? []
  if (!argTypes.length)
    return (
      <p className="px-3 py-4 text-[11px] leading-5 text-neutral-600">
        页面还没有属性声明；让 agent 在设计元数据里补充 argTypes。
      </p>
    )
  const values = state?.args ?? {}
  return (
    <div className="flex flex-col gap-0.5 px-3 pb-6">
      <p className="pb-1 text-[11px] text-neutral-500">
        {state ? `写入状态「${state.name}」` : "先选择一个状态"}
      </p>
      {argTypes.map((definition) => (
        <Control
          key={definition.name}
          definition={definition}
          value={values[definition.name]}
          onChange={(value) =>
            state && onArgsChange(state.id, { ...values, [definition.name]: value })
          }
        />
      ))}
    </div>
  )
}
