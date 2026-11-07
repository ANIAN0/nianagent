import { useState } from "react"
import { api, message } from "./api"
import type { DesignMeta, PageDetail, StorySection } from "./types"

const SECTION_LABEL: Record<StorySection, string> = {
  normal: "正常流程",
  exception: "异常流程",
  states: "不同状态",
}

const Block = ({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) => (
  <section className="border-b border-[var(--border-soft)] px-5 py-4 last:border-b-0">
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)]">
        {title}
      </h3>
      {action}
    </div>
    {children}
  </section>
)

const Table = ({
  head,
  rows,
}: {
  head: string[]
  rows: (string | number)[][]
}) => (
  <table className="w-full border-collapse text-[12px] leading-5">
    <thead>
      <tr>
        {head.map((item) => (
          <th
            key={item}
            className="border-b border-[var(--border)] px-2 py-1 text-left font-medium text-[var(--text-muted)]"
          >
            {item}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row, index) => (
        <tr key={index} className="align-top">
          {row.map((cell, cellIndex) => (
            <td
              key={cellIndex}
              className="border-b border-[var(--border-soft)] px-2 py-1.5 text-[var(--text-2)]"
            >
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
)

const missing = <p className="text-[11px] text-[var(--text-faint)]">未填写。</p>

const fieldClass =
  "w-full rounded bg-[var(--raised)] px-2 py-1.5 text-[12px] leading-5 text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--accent)]"

type StandardsRow = DesignMeta["standards"][number]

/** 元数据表单：字段与 agent 工具共用同一契约，保存走 write_page（全量替换）。 */
function MetaEditor({
  pageId,
  meta,
  onCancel,
  onSaved,
  onError,
}: {
  pageId: string
  meta: DesignMeta | null
  onCancel: () => void
  onSaved: () => void
  onError: (text: string) => void
}) {
  const [description, setDescription] = useState(meta?.description ?? "")
  const [boundary, setBoundary] = useState(meta?.boundary ?? "")
  const [preview, setPreview] = useState(meta?.preview ?? "")
  const [goal, setGoal] = useState(meta?.story?.goal ?? "")
  const [preconditions, setPreconditions] = useState(
    (meta?.story?.preconditions ?? []).join("\n")
  )
  const [result, setResult] = useState(meta?.story?.result ?? "")
  const [tags, setTags] = useState((meta?.tags ?? []).join("、"))
  const [related, setRelated] = useState(
    (meta?.relatedOperations ?? []).join("、")
  )
  const [viewportWidth, setViewportWidth] = useState(
    meta?.viewport ? String(meta.viewport.width) : ""
  )
  const [viewportHeight, setViewportHeight] = useState(
    meta?.viewport ? String(meta.viewport.height) : ""
  )
  const [standards, setStandards] = useState<StandardsRow[]>(
    meta?.standards?.length
      ? meta.standards.map((row) => ({ ...row }))
      : [{ id: "", name: "", rule: "", reason: "", check: "" }]
  )
  const [argTypesDraft, setArgTypesDraft] = useState(
    JSON.stringify(meta?.argTypes ?? [], null, 2)
  )
  const [saving, setSaving] = useState(false)
  const argTypesInvalid = (() => {
    try {
      const parsed: unknown = JSON.parse(argTypesDraft || "[]")
      return !Array.isArray(parsed) ? "argTypes 需为 JSON 数组。" : ""
    } catch {
      return "argTypes 不是有效的 JSON。"
    }
  })()
  const viewportInvalid = (() => {
    if (!viewportWidth && !viewportHeight) return ""
    const width = Number(viewportWidth)
    const height = Number(viewportHeight)
    if (
      !Number.isInteger(width) ||
      width < 240 ||
      width > 2560 ||
      !Number.isInteger(height) ||
      height < 96 ||
      height > 1600
    )
      return "视口需为 240–2560 × 96–1600 的整数。"
    return ""
  })()
  const invalid = argTypesInvalid || viewportInvalid
  const save = async () => {
    if (invalid || saving) return
    setSaving(true)
    const parsedArgTypes = JSON.parse(
      argTypesDraft || "[]"
    ) as DesignMeta["argTypes"]
    const next: DesignMeta = {
      description,
      boundary,
      preview: preview.trim(),
      story:
        goal.trim() || preconditions.trim() || result.trim()
          ? {
              goal: goal.trim(),
              preconditions: preconditions
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
              result: result.trim(),
            }
          : null,
      standards: standards
        .map((row) => ({
          id: row.id.trim(),
          name: row.name.trim(),
          rule: row.rule.trim(),
          reason: row.reason.trim(),
          check: row.check.trim(),
        }))
        .filter((row) => row.id || row.name || row.rule),
      tags: tags
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      viewport:
        viewportWidth && viewportHeight
          ? { width: Number(viewportWidth), height: Number(viewportHeight) }
          : null,
      argTypes: parsedArgTypes,
      relatedOperations: related
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    }
    try {
      await api.writePage(pageId, { meta: next })
      onSaved()
    } catch (error) {
      onError(message(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--text-muted)]">描述</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={`${fieldClass} h-20 resize-y`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--text-muted)]">职责边界</span>
        <textarea
          value={boundary}
          onChange={(event) => setBoundary(event.target.value)}
          className={`${fieldClass} h-16 resize-y`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--text-muted)]">
          预览条目（指向 preview bundle 条目时可留空源码）
        </span>
        <input
          value={preview}
          onChange={(event) => setPreview(event.target.value)}
          className={fieldClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">用户目标</span>
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">预期结果</span>
          <input
            value={result}
            onChange={(event) => setResult(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--text-muted)]">
          前置条件（每行一条）
        </span>
        <textarea
          value={preconditions}
          onChange={(event) => setPreconditions(event.target.value)}
          className={`${fieldClass} h-14 resize-y`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--text-muted)]">设计标准</span>
        <div className="flex flex-col gap-2">
          {standards.map((row, index) => (
            <div
              key={index}
              className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-2"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-faint)]">
                  标准 {index + 1}
                </span>
                <button
                  type="button"
                  className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--danger)]"
                  onClick={() =>
                    setStandards((rows) => rows.filter((_, i) => i !== index))
                  }
                >
                  移除
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={row.id}
                  onChange={(event) =>
                    setStandards((rows) =>
                      rows.map((item, i) =>
                        i === index ? { ...item, id: event.target.value } : item
                      )
                    )
                  }
                  placeholder="标识（如 B1）"
                  className={fieldClass}
                />
                <input
                  value={row.name}
                  onChange={(event) =>
                    setStandards((rows) =>
                      rows.map((item, i) =>
                        i === index
                          ? { ...item, name: event.target.value }
                          : item
                      )
                    )
                  }
                  placeholder="名称"
                  className={fieldClass}
                />
              </div>
              <input
                value={row.rule}
                onChange={(event) =>
                  setStandards((rows) =>
                    rows.map((item, i) =>
                      i === index ? { ...item, rule: event.target.value } : item
                    )
                  )
                }
                placeholder="规则"
                className={`${fieldClass} mt-1.5`}
              />
              <input
                value={row.reason}
                onChange={(event) =>
                  setStandards((rows) =>
                    rows.map((item, i) =>
                      i === index
                        ? { ...item, reason: event.target.value }
                        : item
                    )
                  )
                }
                placeholder="理由"
                className={`${fieldClass} mt-1.5`}
              />
              <input
                value={row.check}
                onChange={(event) =>
                  setStandards((rows) =>
                    rows.map((item, i) =>
                      i === index
                        ? { ...item, check: event.target.value }
                        : item
                    )
                  )
                }
                placeholder="核查方式"
                className={`${fieldClass} mt-1.5`}
              />
            </div>
          ))}
          <button
            type="button"
            className="self-start text-[11px] text-[var(--accent-text)] transition-colors hover:brightness-125"
            onClick={() =>
              setStandards((rows) => [
                ...rows,
                { id: "", name: "", rule: "", reason: "", check: "" },
              ])
            }
          >
            + 添加标准
          </button>
        </div>
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">
            标签（顿号分隔）
          </span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">视口宽</span>
          <input
            type="number"
            value={viewportWidth}
            onChange={(event) => setViewportWidth(event.target.value)}
            placeholder="不限"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">视口高</span>
          <input
            type="number"
            value={viewportHeight}
            onChange={(event) => setViewportHeight(event.target.value)}
            placeholder="不限"
            className={fieldClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--text-muted)]">
          属性 argTypes（JSON
          数组：name/label/description/control/min/max/options/default）
        </span>
        <textarea
          value={argTypesDraft}
          onChange={(event) => setArgTypesDraft(event.target.value)}
          spellCheck={false}
          className={`${fieldClass} h-28 resize-y font-mono text-[11px] leading-4 ${
            argTypesInvalid ? "ring-1 ring-[var(--danger)]" : ""
          }`}
        />
        {argTypesInvalid && (
          <span className="text-[10px] text-[var(--danger)]">
            {argTypesInvalid}
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--text-muted)]">
          关联接口（顿号分隔）
        </span>
        <input
          value={related}
          onChange={(event) => setRelated(event.target.value)}
          className={fieldClass}
        />
      </label>
      {viewportInvalid && (
        <p className="text-[11px] text-[var(--danger)]">{viewportInvalid}</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded px-3 py-1.5 text-xs text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          disabled={!!invalid || saving}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存文档"}
        </button>
      </div>
    </div>
  )
}

/** 文档视图：阅读态展示契约字段；编辑态提供表单与源码编辑器。 */
export function Docs({
  pageId,
  detail,
  operations,
  onSaved,
  onError,
}: {
  pageId: string
  detail: PageDetail
  operations: Map<
    string,
    { module: string; method: string; title: string }
  > | null
  onSaved: () => void
  onError: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [sourceEditing, setSourceEditing] = useState(false)
  const [sourceDraft, setSourceDraft] = useState("")
  const [savingSource, setSavingSource] = useState(false)
  const meta = detail.page.meta
  const states = detail.page.states
  const sections = (["normal", "exception", "states"] as const)
    .map((section) => ({
      section,
      items: states.filter((state) => state.section === section),
    }))
    .filter((group) => group.items.length)
  const saveSource = async () => {
    if (savingSource) return
    setSavingSource(true)
    try {
      await api.writePage(pageId, { code: sourceDraft })
      onSaved()
      setSourceEditing(false)
    } catch (error) {
      onError(message(error))
    } finally {
      setSavingSource(false)
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-3xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-5 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-strong)]">
              {detail.page.title || detail.page.name}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
              {detail.page.source ? "源码末尾 function Page() {...}" : ""}
              {detail.page.states.length
                ? ` · ${detail.page.states.length} 个状态`
                : ""}
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text)]"
              onClick={() => {
                setEditing(true)
                setSourceEditing(false)
              }}
            >
              编辑文档
            </button>
          )}
        </header>
        {editing ? (
          <MetaEditor
            key={detail.page.id + detail.page.updatedAt}
            pageId={pageId}
            meta={meta}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              onSaved()
            }}
            onError={onError}
          />
        ) : (
          <>
            {!meta || (!meta.description && !meta.boundary) ? null : (
              <Block title="描述与边界">
                {meta.description && (
                  <p className="text-[13px] leading-6 whitespace-pre-wrap text-[var(--text)]">
                    {meta.description}
                  </p>
                )}
                {meta.boundary && (
                  <p className="mt-2 text-[12px] leading-5 whitespace-pre-wrap text-[var(--text-3)]">
                    边界：{meta.boundary}
                  </p>
                )}
              </Block>
            )}
            {meta?.story && (
              <Block title="用户故事">
                <dl className="flex flex-col gap-1.5 text-[12px] leading-5">
                  {meta.story.goal && (
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-[var(--text-muted)]">
                        目标
                      </dt>
                      <dd className="text-[var(--text)]">{meta.story.goal}</dd>
                    </div>
                  )}
                  {meta.story.preconditions.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-[var(--text-muted)]">
                        前置
                      </dt>
                      <dd className="text-[var(--text)]">
                        {meta.story.preconditions.join("；")}
                      </dd>
                    </div>
                  )}
                  {meta.story.result && (
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-[var(--text-muted)]">
                        结果
                      </dt>
                      <dd className="text-[var(--text)]">
                        {meta.story.result}
                      </dd>
                    </div>
                  )}
                </dl>
              </Block>
            )}
            {meta?.standards.length ? (
              <Block title="设计标准">
                <Table
                  head={["标准", "规则", "理由", "核查"]}
                  rows={meta.standards.map((item) => [
                    item.name || item.id,
                    item.rule,
                    item.reason,
                    item.check,
                  ])}
                />
              </Block>
            ) : null}
            {sections.length ? (
              <Block title="状态">
                <div className="flex flex-col gap-4">
                  {sections.map((group) => (
                    <div key={group.section}>
                      <p className="mb-1 text-[11px] text-[var(--text-muted)]">
                        {SECTION_LABEL[group.section]}
                      </p>
                      <Table
                        head={["状态", "条件", "预期", "步骤"]}
                        rows={group.items.map((state) => [
                          `${state.name}（${state.id}）`,
                          state.condition,
                          state.expected,
                          state.steps.length ? state.steps.join(" → ") : "",
                        ])}
                      />
                      {group.items
                        .filter((state) => state.knownIssue)
                        .map((state) => (
                          <p
                            key={state.id}
                            className="mt-1 text-[11px] text-[var(--warning)]"
                          >
                            已知问题（{state.name}）：{state.knownIssue}
                          </p>
                        ))}
                    </div>
                  ))}
                </div>
              </Block>
            ) : null}
            {meta?.argTypes.length ? (
              <Block title="属性">
                <Table
                  head={["属性", "控件", "说明"]}
                  rows={meta.argTypes.map((item) => [
                    item.name,
                    item.control === "number"
                      ? `number ${item.min ?? ""}–${item.max ?? ""}`
                      : item.control === "select"
                        ? `select（${item.options.join("/")}）`
                        : item.control,
                    item.description || item.label,
                  ])}
                />
              </Block>
            ) : null}
            {meta?.relatedOperations.length ? (
              <Block title="关联接口">
                <ul className="flex flex-col gap-1.5">
                  {meta.relatedOperations.map((id) => {
                    const operation = operations?.get(id)
                    return (
                      <li key={id} className="text-[12px] leading-5">
                        {operation ? (
                          <>
                            <span className="text-[var(--text)]">
                              {operation.title || operation.method}
                            </span>
                            <span className="ml-1.5 text-[var(--text-muted)]">
                              {operation.module} · {operation.method}
                            </span>
                          </>
                        ) : (
                          <span className="text-[var(--warning)]">
                            {id}（未找到）
                          </span>
                        )}
                        <span className="ml-1.5 font-mono text-[10px] text-[var(--text-faint)]">
                          {id}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </Block>
            ) : null}
            <Block
              title="源码"
              action={
                detail.page.source ? (
                  <button
                    type="button"
                    className="text-[11px] text-[var(--accent-text)] transition-colors hover:brightness-125"
                    onClick={() => {
                      setSourceDraft(detail.page.source)
                      setSourceEditing((value) => !value)
                    }}
                  >
                    {sourceEditing ? "取消编辑" : "编辑源码"}
                  </button>
                ) : undefined
              }
            >
              {sourceEditing && detail.page.source ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={sourceDraft}
                    onChange={(event) => setSourceDraft(event.target.value)}
                    spellCheck={false}
                    className="h-80 w-full resize-y rounded-lg bg-[var(--canvas-dark)] p-3 font-mono text-[11px] leading-5 text-[var(--text-2)] ring-1 ring-[var(--border)] outline-none focus:ring-[var(--accent)]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 text-xs text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
                      onClick={() => setSourceEditing(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={savingSource || !sourceDraft.trim()}
                      className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
                      onClick={() => void saveSource()}
                    >
                      {savingSource ? "保存中…" : "保存源码"}
                    </button>
                  </div>
                </div>
              ) : detail.page.source ? (
                <pre className="overflow-x-auto rounded-lg bg-[var(--canvas-dark)] p-3 font-mono text-[11px] leading-5 text-[var(--text-2)]">
                  {detail.page.source}
                </pre>
              ) : (
                missing
              )}
            </Block>
          </>
        )}
      </div>
    </div>
  )
}
