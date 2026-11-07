// 预览专用轻量 PatchDiff：@pierre/diffs 连带语法高亮引擎体积过大（约 12MB），
// 预览环境只需要可读的统一差异渲染。仅由 scripts/build-notes-preview.mjs
// 在构建预览 bundle 时以别名替换 @pierre/diffs(/react)，应用本体不受影响。
import { useMemo } from "react"

type DiffLine = {
  kind: "add" | "del" | "ctx" | "hunk" | "meta"
  text: string
  oldNo?: number
  newNo?: number
}

/** 解析统一差异文本；不识别的行按上下文呈现，保证容错。 */
function parseUnified(patch: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of patch.split(/\r?\n/)) {
    if (
      /^(---|\+\+\+|index |diff --git|new file mode|deleted file mode|--- a\/|\+\+\+ b\/)/.test(
        raw
      )
    ) {
      lines.push({ kind: "meta", text: raw })
      continue
    }
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      lines.push({ kind: "hunk", text: raw })
      continue
    }
    if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), newNo })
      newNo += 1
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", text: raw.slice(1), oldNo })
      oldNo += 1
    } else if (raw.startsWith(" ")) {
      lines.push({ kind: "ctx", text: raw.slice(1), oldNo, newNo })
      oldNo += 1
      newNo += 1
    } else if (raw === "" && oldNo && newNo) {
      lines.push({ kind: "ctx", text: "", oldNo, newNo })
      oldNo += 1
      newNo += 1
    } else {
      lines.push({ kind: "meta", text: raw })
    }
  }
  return lines
}

const LINE_STYLE: Record<DiffLine["kind"], string> = {
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  del: "bg-red-500/10 text-red-700 dark:text-red-300",
  ctx: "",
  hunk: "text-sky-600 dark:text-sky-400",
  meta: "text-neutral-500",
}

const GAUGE: Record<DiffLine["kind"], string> = {
  add: "+",
  del: "-",
  ctx: " ",
  hunk: "@",
  meta: " ",
}

/** 统一差异的可读渲染；不支持语法高亮与 worker 池（预览场景可接受）。 */
export function PatchDiff({
  patch,
}: {
  patch: string
  options?: { diffStyle?: string }
  disableWorkerPool?: boolean
}) {
  const lines = useMemo(() => parseUnified(patch ?? ""), [patch])
  return (
    <pre className="overflow-x-auto rounded-lg border border-current/15 bg-current/5 p-0 font-mono text-[11px] leading-5">
      <code className="block">
        {lines.map((line, index) => (
          <div
            key={index}
            className={`flex gap-2 px-2 ${line.kind === "hunk" ? "my-1 border-y border-current/10 py-0.5" : ""} ${LINE_STYLE[line.kind]}`}
          >
            <span className="w-16 shrink-0 text-right opacity-45 select-none">
              {line.oldNo ?? ""}
            </span>
            <span className="w-16 shrink-0 text-right opacity-45 select-none">
              {line.newNo ?? ""}
            </span>
            <span className="w-3 shrink-0 opacity-60 select-none">
              {GAUGE[line.kind]}
            </span>
            <span className="break-all whitespace-pre-wrap">{line.text}</span>
          </div>
        ))}
      </code>
    </pre>
  )
}
export default PatchDiff
