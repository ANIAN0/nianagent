// @ts-check
// ContentKind/Reader 注册接口（S0c 契约 v1 的最小落地，Q12）：
// storage 只经 readerFor(kind) 调用各类型的导入校验与派生，不内嵌类型私有规则；三类互不依赖。
// 首版 S2a 仅 markdown 提供完整实现；board/ui 的专用校验与派生随 S2b 在各自 reader 中补齐。
import { WorkbenchError } from "./errors.mjs"
import { generateReading } from "./markdown.mjs"
import { boardReader } from "./readers/board.mjs"
import { uiReader } from "./readers/ui.mjs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const markdownReader = {
  /** markdown 包必须恰有一个根级 .md 正文入口；禁止猜测正文。 */
  validateEntries(entries) {
    const entryNames = entries
      .filter(
        (entry) =>
          !entry.path.includes("/") && entry.path.toLowerCase().endsWith(".md")
      )
      .map((entry) => entry.path)
    if (entryNames.length === 0)
      throw new WorkbenchError(
        "validation_failed",
        "markdown 包缺少根级 .md 正文入口。"
      )
    if (entryNames.length > 1)
      throw new WorkbenchError(
        "validation_failed",
        `markdown 正文入口不唯一（${entryNames.join("、")}），无法确定正文。`
      )
  },
  /** 封存前在 staging 内生成冻结阅读表示：管线版本 + 入口 + 块投影/净化 HTML。 */
  async derive(stagingDir) {
    const entry = ".moon/reading.json"
    const reading = await generateReading(stagingDir)
    await mkdir(join(stagingDir, ".moon"), { recursive: true })
    await writeFile(
      join(stagingDir, ".moon", "reading.json"),
      JSON.stringify(reading)
    )
    return { entry, reading }
  },
}

export function readerFor(kind) {
  if (kind === "markdown") return markdownReader
  if (kind === "board") return boardReader
  if (kind === "ui") return uiReader
  throw new WorkbenchError(
    "validation_failed",
    "草稿类型仅支持 markdown/board/ui。"
  )
}
