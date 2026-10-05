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

  const slash = text.match(/^\/(skill:)?([\p{L}\p{N}_-]*)/u)
  if (!slash || start > slash[0].length) return null
  const prefix = slash[1] ? "/skill:".length : 1
  return {
    mode: slash[1] ? "skill" : "slash",
    query: text.slice(Math.min(prefix, start), start),
    start: 0,
    end: slash[0].length,
  }
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
