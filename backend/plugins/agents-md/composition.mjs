// Locate the last applied segments in the current file. Text between them belongs to the project.
export function composeProject(current, previous, snippets, ids, resolution) {
  const eol = current.includes("\r\n") ? "\r\n" : "\n"
  const saved = previous?.segments ?? []
  const selected = ids.map((id) => {
    const snippet = snippets.find((item) => item.id === id)
    const prior = saved.find((item) => item.id === id)
    if (!snippet && !prior) throw new Error("所选片段已删除，请重新选择。")
    return {
      id,
      name: snippet?.name ?? prior.name,
      text: snippet
        ? snippet.content.trim().replace(/\r?\n/g, eol)
        : prior.text,
    }
  })
  if (resolution !== undefined)
    return {
      content: resolution,
      segments: selected.filter(
        (s) =>
          s.text &&
          resolution.indexOf(s.text) >= 0 &&
          resolution.indexOf(s.text) === resolution.lastIndexOf(s.text)
      ),
    }
  const locations = []
  for (const segment of saved) {
    const start = current.indexOf(segment.text)
    if (
      !segment.text ||
      start < 0 ||
      start !== current.lastIndexOf(segment.text)
    ) {
      throw new Error(
        "项目中的片段已被修改或无法唯一定位，请手工合并后重新预览。"
      )
    }
    locations.push({ id: segment.id, start, end: start + segment.text.length })
  }
  locations.sort((a, b) => a.start - b.start)
  let cursor = 0,
    content = ""
  const retained = new Set(saved.map((segment) => segment.id))
  const selectedIds = new Set(ids)
  let next = 0
  for (const location of locations) {
    if (location.start < cursor) throw new Error("片段范围重叠，请手工合并。")
    content += current.slice(cursor, location.start)
    if (selectedIds.has(location.id)) {
      const group = []
      while (next < selected.length) {
        const segment = selected[next++]
        if (segment.text) group.push(segment.text)
        if (retained.has(segment.id)) break
      }
      content += group.join(eol + eol)
    }
    cursor = location.end
  }
  content += current.slice(cursor)
  const extra = selected
    .slice(next)
    .map((s) => s.text)
    .filter(Boolean)
  if (extra.length) {
    const ends = current.endsWith("\n")
    if (content && !content.endsWith(eol + eol))
      content += content.endsWith(eol) ? eol : eol + eol
    content += extra.join(eol + eol) + (ends ? eol : "")
  }
  return { content, segments: selected }
}
