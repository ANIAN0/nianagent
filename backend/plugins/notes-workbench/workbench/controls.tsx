import { useEffect, useRef, useState } from "react"
import type { ArgType, ArgValue, PageDetail, PageState } from "./types"

type Values = Record<string, ArgValue>

const numberValue = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

/** 值与默认值的差异即「已修改」；没有默认值的属性不标记。 */
const isModified = (definition: ArgType, value: ArgValue | undefined) => {
  if (definition.default === undefined) return false
  return (
    JSON.stringify(value ?? null) !== JSON.stringify(definition.default ?? null)
  )
}

function Control({
  definition,
  value,
  onChange,
}: {
  definition: ArgType
  value: ArgValue | undefined
  onChange: (value: ArgValue) => void
}) {
  const label = definition.label || definition.name
  const [draft, setDraft] = useState<string | null>(null)
  const committed = useRef<string | null>(null)
  useEffect(() => {
    if (committed.current === null) return
    committed.current = null
    setDraft(null)
  }, [value])
  const beginDraft = () => {
    if (draft === null) setDraft(typeof value === "string" ? value : "")
  }
  const commitDraft = (fallback: ArgValue) => {
    if (draft === null) return
    committed.current = draft
    if (
      draft === "" &&
      (definition.control === "string" || definition.control === "color")
    )
      onChange(fallback)
    else onChange(draft)
  }
  const invalidObject = (() => {
    if (definition.control !== "object" || draft === null) return false
    try {
      JSON.parse(draft)
      return false
    } catch {
      return true
    }
  })()
  const header = (
    <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-2)]">
      {isModified(definition, value) && (
        <span
          aria-label="已修改"
          title="与默认值不同"
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
        />
      )}
      <span title={definition.description || label}>{label}</span>
    </span>
  )
  if (definition.control === "boolean")
    return (
      <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
        {header}
        <button
          type="button"
          role="switch"
          aria-checked={value === true}
          className={`relative h-4.5 w-8 shrink-0 rounded-full transition-colors ${
            value === true ? "bg-[var(--accent)]" : "bg-[var(--pin-idle)]"
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
        <span className="flex items-center justify-between text-[12px] text-[var(--text-2)]">
          {header}
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {numberValue(value, definition.min ?? 0)}
          </span>
        </span>
        <input
          type="range"
          min={definition.min ?? 0}
          max={definition.max ?? 100}
          step="any"
          value={numberValue(value, definition.min ?? 0)}
          onChange={(event) => onChange(Number(event.target.value))}
          className="mt-1 w-full accent-[var(--accent)]"
        />
      </label>
    )
  if (definition.control === "select")
    return (
      <label className="flex items-center justify-between gap-3 py-1">
        <span className="min-w-0 shrink-0">{header}</span>
        <select
          value={
            typeof value === "string"
              ? value
              : String(definition.default ?? definition.options[0] ?? "")
          }
          onChange={(event) => onChange(event.target.value)}
          className="max-w-40 min-w-0 flex-1 rounded bg-[var(--raised)] px-1.5 py-1 text-[12px] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          {definition.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    )
  if (definition.control === "color")
    return (
      <label className="flex items-center justify-between gap-3 py-1">
        <span className="min-w-0 shrink-0">{header}</span>
        <span className="flex max-w-40 min-w-0 flex-1 items-center gap-1">
          <input
            type="color"
            value={
              typeof value === "string" && value.startsWith("#")
                ? value
                : "#000000"
            }
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
            className="h-6 w-7 shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
          />
          <input
            value={draft ?? (typeof value === "string" ? value : "")}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={beginDraft}
            onBlur={() => commitDraft("")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commitDraft("")
                event.currentTarget.blur()
              }
            }}
            placeholder="颜色值"
            className="min-w-0 flex-1 rounded bg-[var(--raised)] px-1.5 py-1 font-mono text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent)]"
          />
        </span>
      </label>
    )
  if (definition.control === "object")
    return (
      <label className="block py-1">
        <span className="flex items-center justify-between">{header}</span>
        <textarea
          value={
            draft ?? JSON.stringify(value ?? definition.default ?? {}, null, 2)
          }
          onChange={(event) => setDraft(event.target.value)}
          onFocus={beginDraft}
          onBlur={() => {
            if (draft === null || invalidObject) return
            try {
              committed.current = draft
              onChange(JSON.parse(draft) as ArgValue)
            } catch {
              /* 失焦时无效 JSON 不提交。 */
            }
          }}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key === "Enter" &&
              !invalidObject
            ) {
              event.preventDefault()
              try {
                committed.current = draft
                onChange(JSON.parse(draft ?? "") as ArgValue)
                setDraft(null)
              } catch {
                /* Ctrl+Enter 时无效 JSON 不提交。 */
              }
            }
          }}
          spellCheck={false}
          className={`mt-1 h-20 w-full resize-y rounded bg-[var(--raised)] p-2 font-mono text-[11px] leading-4 text-[var(--text)] outline-none focus:ring-1 ${
            invalidObject
              ? "ring-1 ring-[var(--danger)]"
              : "focus:ring-[var(--accent)]"
          }`}
        />
        {invalidObject && (
          <p className="mt-0.5 text-[10px] text-[var(--danger)]">
            JSON 无效；失焦或 Ctrl+Enter 时有效值才会写入。
          </p>
        )}
      </label>
    )
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0 shrink-0">{header}</span>
      <input
        value={draft ?? (typeof value === "string" ? value : "")}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={beginDraft}
        onBlur={() => commitDraft("")}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commitDraft("")
            event.currentTarget.blur()
          }
        }}
        placeholder={label}
        className="max-w-40 min-w-0 flex-1 rounded bg-[var(--raised)] px-1.5 py-1 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent)]"
      />
    </label>
  )
}

/** 属性面板：控件由 argTypes 驱动，写入选中状态的 args（与 agent 共用同一份数据）。 */
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
      <p className="px-3 py-4 text-[11px] leading-5 text-[var(--text-faint)]">
        页面还没有属性声明；在文档视图「编辑」里补充 argTypes。
      </p>
    )
  const values = state?.args ?? {}
  const resetAll = () => {
    if (!state) return
    const values_: Values = {}
    for (const definition of argTypes)
      if (definition.default !== undefined)
        values_[definition.name] = definition.default
    onArgsChange(state.id, values_)
  }
  const modifiedCount = argTypes.filter((definition) =>
    isModified(definition, values[definition.name])
  ).length
  return (
    <div className="flex flex-col gap-0.5 px-3 pb-6">
      <div className="flex items-center justify-between pb-1">
        <p className="text-[11px] text-[var(--text-muted)]">
          {state ? `写入状态「${state.name}」` : "先选择一个状态"}
        </p>
        {state && (
          <button
            type="button"
            disabled={!modifiedCount}
            className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-2)] disabled:opacity-40 disabled:hover:text-[var(--text-muted)]"
            onClick={resetAll}
            title="恢复全部属性为默认值"
          >
            重置{modifiedCount ? `（${modifiedCount}）` : ""}
          </button>
        )}
      </div>
      {argTypes.map((definition) => (
        <Control
          key={definition.name}
          definition={definition}
          value={values[definition.name]}
          onChange={(value) =>
            state &&
            onArgsChange(state.id, { ...values, [definition.name]: value })
          }
        />
      ))}
    </div>
  )
}
