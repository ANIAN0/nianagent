// Labels stay in the presentation layer; supported levels come from Pi via RPC.
export const thinkingLabels: Record<string, string> = {
  off: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中等",
  high: "高",
  xhigh: "极高",
  max: "最高",
}
export function effectiveThinking(value: string, options?: readonly string[]) {
  if (!options) return value
  return options.includes(value) ? value : (options[0] ?? "")
}
