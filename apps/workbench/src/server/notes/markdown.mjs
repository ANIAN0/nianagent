// @ts-check
// S2a Markdown 管线（正式模块）：冻结净化 HTML + DOM 文本块投影 + 服务端锚点解析。
// - 投影 = 渲染后 DOM 的文本内容（行内格式剥离、实体还原、原始 HTML 以源码文本呈现）
// - 偏移一律 Unicode 码点；DOM/Range 侧由 UI 经 cpToUtf16 转换（Q04）
// - URL 净化：仅 http/https/mailto、data:image 与相对路径；危险协议拒绝渲染属性（Q07）
import { Marked } from "marked"
import { parseEntities } from "parse-entities"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

/** 冻结阅读表示的管线版本：投影语义变更时递增，旧版本按各自封存表示解释（Q04）。 */
export const READING_PIPELINE_VERSION = 2

const escapeHtml = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** URL 净化：返回可渲染的 URL，拒绝时返回 null。相对路径/锚点保留（指向版本内资源）。 */
export function safeUrl(url, { image = false } = {}) {
  const raw = String(url ?? "").trim()
  if (!raw) return null
  // 浏览器会忽略协议内的制表/换行等控制字符，不能把它们误当相对路径。
  if (
    [...raw].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  )
    return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^mailto:/i.test(raw)) return image ? null : raw
  if (/^data:image\//i.test(raw)) return image ? raw : null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null // javascript:/vbscript:/file:/data: 等一律拒绝
  return raw
}

/** 阅读渲染器：原始 HTML 整体转义（严格策略）+ 链接/图片 URL 净化。 */
const readingMarked = new Marked({
  gfm: true,
  renderer: {
    html(token) {
      return escapeHtml(token.text ?? token.raw ?? "")
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens ?? [])
      const href = safeUrl(token.href)
      if (href === null) return `<a>${text}</a>`
      return `<a href="${escapeHtml(href)}">${text}</a>`
    },
    image(token) {
      const text = escapeHtml(token.text ?? "")
      const src = safeUrl(token.href, { image: true })
      if (src === null) return text
      return `<img src="${escapeHtml(src)}" alt="${text}">`
    },
  },
})

/** 行内 token 的 DOM 文本提取（与净化渲染后的 DOM textContent 一致）。 */
const inlineTextOf = (token) => {
  if (token.type === "image") return token.text ?? ""
  if (token.tokens) return (token.tokens ?? []).map(inlineTextOf).join("")
  switch (token.type) {
    case "code":
    case "codespan":
    case "html":
    case "escape":
      return token.text ?? ""
    case "text":
      return parseEntities(token.text ?? "")
    case "link":
    case "image":
      return token.text ?? ""
    case "br":
      return "\n"
    default:
      return token.text ?? ""
  }
}

const blockTextOf = (token) => {
  switch (token.type) {
    case "html":
      return token.text ?? token.raw ?? ""
    case "heading":
    case "paragraph":
      return (token.tokens ?? []).map(inlineTextOf).join("")
    case "text":
      return (
        (token.tokens ?? []).map(inlineTextOf).join("") || (token.text ?? "")
      )
    case "code":
      return token.text ?? ""
    case "blockquote": {
      const inner = (token.tokens ?? []).map(blockTextOf).filter(Boolean)
      return inner.join("\n")
    }
    case "list": {
      const items = (token.items ?? []).map((item) => {
        const parts = (item.tokens ?? []).map(blockTextOf).filter(Boolean)
        return parts.join(" ")
      })
      return items.join("\n")
    }
    case "table": {
      const rows = [token.header ?? [], ...(token.rows ?? [])]
      return rows
        .map((cells) => cells.map((cell) => inlineTextOf(cell)).join(" | "))
        .join("\n")
    }
    default:
      return ""
  }
}

/** 解析 Markdown → 冻结块投影 [{index, type, text, html}]（text 为 DOM 文本；码点偏移基准）。 */
export function parseBlocks(markdown) {
  const tokens = readingMarked.lexer(String(markdown ?? ""), { gfm: true })
  const blocks = []
  for (const token of tokens) {
    const text = blockTextOf(token)
    if (token.type === "space") continue
    blocks.push({
      index: blocks.length,
      type: token.type,
      text,
      html: readingMarked.parse(token.raw),
    })
  }
  return blocks
}

/**
 * 读取 staging 内根级 .md 正文并生成冻结阅读表示（stage 派生步骤，随包封存）。
 * 返回 { pipeline, entry, blocks }；正文入口由 reader.validateEntries 保证唯一。
 */
export async function generateReading(stagingDir) {
  const names = (await readdir(stagingDir)).filter(
    (name) => !name.includes("/") && name.toLowerCase().endsWith(".md")
  )
  if (names.length !== 1)
    throw new Error("markdown 正文入口不唯一或缺失，无法生成冻结阅读表示。")
  const entry = names[0]
  const raw = await readFile(join(stagingDir, entry), "utf8")
  return { pipeline: READING_PIPELINE_VERSION, entry, blocks: parseBlocks(raw) }
}

export class InvalidAnchorError extends Error {
  constructor(reason, message) {
    super(message)
    this.code = "invalid_anchor"
    this.reason = reason // not_found | ambiguous | non_contiguous | range_invalid
  }
}

export const cpToUtf16 = (text, cpOffset) =>
  [...text].slice(0, cpOffset).join("").length
export const cpSlice = (text, start, end) =>
  [...text].slice(start, end).join("")

/** 码点数组内的子串搜索（统一坐标单位，emoji 安全，Q04）。 */
const indexOfCp = (haystack, needle, from = 0) => {
  if (needle.length === 0) return from
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * 服务端唯一锚点解析：block + exact + 可选 prefix/suffix → 码点范围。
 * 重复无上下文 → ambiguous；不存在/上下文不匹配 → not_found；空引文 → range_invalid。
 */
export function resolveAnchor(
  blocks,
  { block, exact, prefix = "", suffix = "" }
) {
  const target = blocks[block]
  if (!target)
    throw new InvalidAnchorError(
      "not_found",
      `块 ${block} 不存在（invalid_anchor）`
    )
  if (typeof exact !== "string" || !exact)
    throw new InvalidAnchorError(
      "range_invalid",
      "exact 引文不能为空（invalid_anchor）"
    )
  const cps = [...target.text]
  const exactCps = [...exact]
  const prefixCps = [...prefix]
  const suffixCps = [...suffix]
  const positions = []
  let from = 0
  while (true) {
    const at = indexOfCp(cps, exactCps, from)
    if (at === -1) break
    positions.push(at)
    from = at + 1
  }
  if (positions.length === 0)
    throw new InvalidAnchorError(
      "not_found",
      "引文在指定块中不存在（invalid_anchor）"
    )
  let candidates = positions
  if (prefixCps.length > 0)
    candidates = candidates.filter((at) =>
      prefixCps.every(
        (cp, offset) => cps[at - prefixCps.length + offset] === cp
      )
    )
  if (suffixCps.length > 0)
    candidates = candidates.filter((at) =>
      suffixCps.every((cp, offset) => cps[at + exactCps.length + offset] === cp)
    )
  if (candidates.length === 0)
    throw new InvalidAnchorError(
      "not_found",
      "上下文不匹配，引文定位失败（invalid_anchor）"
    )
  if (candidates.length > 1)
    throw new InvalidAnchorError(
      "ambiguous",
      `引文出现 ${candidates.length} 次，需要前后文消歧（invalid_anchor）`
    )
  const at = candidates[0]
  return { block, exact, start: at, end: at + exactCps.length }
}

/** 跨块连续选择：有序片段逐段解析，块相邻且覆盖到块边界，否则 non_contiguous。 */
export function resolveCrossBlock(blocks, segments) {
  if (!Array.isArray(segments) || segments.length === 0)
    throw new InvalidAnchorError(
      "range_invalid",
      "跨块选择不能为空（invalid_anchor）"
    )
  const resolved = segments.map((segment) => resolveAnchor(blocks, segment))
  for (let i = 0; i < resolved.length - 1; i++) {
    const current = resolved[i]
    const next = resolved[i + 1]
    const tail = current.end === [...blocks[current.block].text].length
    if (next.block !== current.block + 1 || !tail || next.start !== 0)
      throw new InvalidAnchorError(
        "non_contiguous",
        "跨块片段不连续（invalid_anchor）"
      )
  }
  return resolved
}

/** 线程定位引用的持久化形状（resolved 快照，供历史呈现）。 */
export function snapshotAnchor(resolved, blocks) {
  if (Array.isArray(resolved)) {
    return {
      kind: "markdown",
      segments: resolved.map((r) => ({
        block: r.block,
        start: r.start,
        end: r.end,
        quote: cpSlice(blocks[r.block].text, r.start, r.end),
      })),
    }
  }
  return {
    kind: "markdown",
    block: resolved.block,
    start: resolved.start,
    end: resolved.end,
    quote: cpSlice(blocks[resolved.block].text, resolved.start, resolved.end),
  }
}
