// @ts-check
const PATTERNS = [
  { pattern: /bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, replace: "Bearer [已脱敏]" },
  {
    pattern:
      /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|pwd)(["']?\s*[:=]\s*["']?)[^\s"',;}]{4,}/gi,
    replace: "$1$2[已脱敏]",
  },
  { pattern: /\bsk-[A-Za-z0-9._-]{8,}/g, replace: "[已脱敏]" },
]

/** 对错误文本做出口脱敏；非字符串原样返回。 */
export function redactSensitive(text) {
  if (typeof text !== "string" || text === "") return text
  let out = text
  for (const { pattern, replace } of PATTERNS)
    out = out.replace(pattern, replace)
  return out
}

/** 仅提取脱敏后的堆栈位置帧，不包含异常首行与入参内容。 */
export function diagnosticFrames(error) {
  return typeof error?.stack === "string"
    ? redactSensitive(
        error.stack
          .split("\n")
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 12)
          .join("\n")
      )
        .replace(/(?:file:\/\/\/)?[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g, "[user]")
        .replace(/\/(?:home|Users)\/[^/\s]+/g, "[user]")
        .slice(0, 1600)
    : ""
}
