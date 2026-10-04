/** The collapsed summary must not echo an unfinished streaming line. */
export function thinkingSummary(text: string, running = false): string {
  const lines = text.split(/\r\n?|\n/)
  // split leaves an empty last item after a line terminator. Removing that
  // item also correctly excludes the current partial line when one exists.
  if (running) lines.pop()
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const source = lines[index]!.trim()
    if (!source || /^(?:`{3,}|~{3,}|[-*_]{3,})\s*\w*$/.test(source)) continue
    const readable = source
      .replace(/^#{1,6}\s*/, "")
      .replace(/^(?:>\s*)+/, "")
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*|__|`/g, "")
      .trim()
    if (readable) return readable
  }
  return running ? "正在分析…" : "思考已结束"
}
