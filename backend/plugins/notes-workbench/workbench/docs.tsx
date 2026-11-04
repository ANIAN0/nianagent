import type { ReactNode } from "react"
import type { PageDetail, StorySection } from "./types"

const SECTION_LABEL: Record<StorySection, string> = {
  normal: "正常流程",
  exception: "异常流程",
  states: "不同状态",
}

const Block = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <section className="border-b border-[#3c3c3c] px-5 py-4 last:border-b-0">
    <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500">
      {title}
    </h3>
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
            className="border-b border-[#3c3c3c] px-2 py-1 text-left font-medium text-neutral-500"
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
              className="border-b border-[#2e2e2e] px-2 py-1.5 text-neutral-300"
            >
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
)

const missing = (
  <p className="text-[11px] text-neutral-600">未填写。</p>
)

export function Docs({
  detail,
  operations,
}: {
  detail: PageDetail
  operations: Map<string, { module: string; method: string; title: string }> | null
}) {
  const meta = detail.page.meta
  const states = detail.page.states
  const sections = (
    ["normal", "exception", "states"] as const
  ).map((section) => ({
      section,
      items: states.filter((state) => state.section === section),
    }))
    .filter((group) => group.items.length)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#1e1e1e]">
      <div className="mx-auto max-w-3xl bg-[#1e1e1e]">
        <header className="border-b border-[#3c3c3c] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-neutral-100">
            {detail.page.title || detail.page.name}
          </h2>
          <p className="mt-1 font-mono text-[11px] text-neutral-500">
            {detail.page.source ? "源码末尾 function Page() {...}" : ""}
            {detail.page.states.length
              ? ` · ${detail.page.states.length} 个状态`
              : ""}
          </p>
        </header>
        {!meta || (!meta.description && !meta.boundary) ? null : (
          <Block title="描述与边界">
            {meta.description && (
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-neutral-200">
                {meta.description}
              </p>
            )}
            {meta.boundary && (
              <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-neutral-400">
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
                  <dt className="w-14 shrink-0 text-neutral-500">目标</dt>
                  <dd className="text-neutral-200">{meta.story.goal}</dd>
                </div>
              )}
              {meta.story.preconditions.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-neutral-500">前置</dt>
                  <dd className="text-neutral-200">
                    {meta.story.preconditions.join("；")}
                  </dd>
                </div>
              )}
              {meta.story.result && (
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-neutral-500">结果</dt>
                  <dd className="text-neutral-200">{meta.story.result}</dd>
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
                  <p className="mb-1 text-[11px] text-neutral-500">
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
                        className="mt-1 text-[11px] text-amber-400/80"
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
                        <span className="text-neutral-200">
                          {operation.title || operation.method}
                        </span>
                        <span className="ml-1.5 text-neutral-500">
                          {operation.module} · {operation.method}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-400/80">{id}（未找到）</span>
                    )}
                    <span className="ml-1.5 font-mono text-[10px] text-neutral-600">
                      {id}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Block>
        ) : null}
        <Block title="源码">
          {detail.page.source ? (
            <pre className="overflow-x-auto rounded-lg bg-[#16181d] p-3 font-mono text-[11px] leading-5 text-neutral-300">
              {detail.page.source}
            </pre>
          ) : (
            missing
          )}
        </Block>
      </div>
    </div>
  )
}
