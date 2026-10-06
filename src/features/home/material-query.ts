export type MaterialQuery = {
  mode: "file" | "slash" | "skill"
  query: string
  start: number
  end: number
}

/** Search resource identity independently of its shortened visible label. */
export function materialCandidateMatches(searchText: string, query: string) {
  return searchText
    .replaceAll("\\", "/")
    .toLowerCase()
    .includes(query.replaceAll("\\", "/").toLowerCase())
}

/** Locate the current complete token; a moved caret must not reuse an old range. */
export function materialQueryAtSelection(
  text: string,
  start: number,
  end = start
): MaterialQuery | null {
  if (start !== end || start <= 0 || start > text.length) return null

  const files = /(^|\s)@(?:"([^"\r\n]*)"?|([^\s@]*))/gu
  for (const match of text.matchAll(files)) {
    const tokenStart = match.index + match[1]!.length
    const tokenEnd = match.index + match[0].length
    if (start <= tokenStart || start > tokenEnd) continue
    const quoted = match[2] !== undefined
    const prefix = tokenStart + (quoted ? 2 : 1)
    return {
      mode: "file",
      query: text.slice(prefix, start).replace(/"$/u, ""),
      start: tokenStart,
      end: tokenEnd,
    }
  }

  for (const slash of text.matchAll(/^(\s*)\/(skill:)?([^\s]*)/gu)) {
    const tokenStart = slash.index + slash[1]!.length
    const tokenEnd = slash.index + slash[0].length
    if (start <= tokenStart || start > tokenEnd) continue
    if (text[tokenEnd] && !/\s/u.test(text[tokenEnd]!)) continue
    if (!slash[2] && !/^[\p{L}\p{N}_-]*$/u.test(slash[3]!)) continue
    const prefix = tokenStart + (slash[2] ? "/skill:".length : 1)
    return {
      mode: slash[2] ? "skill" : "slash",
      query: text.slice(Math.min(prefix, start), start),
      start: tokenStart,
      end: tokenEnd,
    }
  }
  return null
}

/** Skill selection changes only the leading text token, never a material identity. */
export function replaceLeadingSkill(text: string, name: string) {
  const leading = text.match(
    /^(\s*)\/(?:skill:[^\s]*|[\p{L}\p{N}_-]*)(?=\s|$)/u
  )
  const start = leading ? leading[1]!.length : 0
  const end = leading ? leading[0].length : 0
  const suffix = text.slice(end)
  const separator = suffix.match(/^\s+/u)?.[0] ?? ""
  const updated = replaceMaterialQuery(
    text,
    { start, end },
    `/skill:${name}${separator ? "" : " "}`
  )
  return { ...updated, caret: updated.caret + separator.length }
}

export function replaceMaterialQuery(
  text: string,
  range: Pick<MaterialQuery, "start" | "end">,
  replacement: string
) {
  return {
    text: text.slice(0, range.start) + replacement + text.slice(range.end),
    caret: range.start + replacement.length,
  }
}
