// @ts-check
/** AC13：各出口统一的敏感内容剔除。令牌/授权头/密钥形态不进入本地 JSONL 日志、
 * 业务日志（ActivityLog）、MCP 工具错误文本或导出；保留错误码与关联标识，
 * 不改变结构化字段（code/errorId/outcome）与业务回执。 */

const PATTERNS = [
  // Authorization 头与 Bearer 令牌（保留 scheme，剔除凭据本体）
  { pattern: /bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, replace: "Bearer [已脱敏]" },
  // 常见凭据键值形态（key: value / key=value / key": "value"）
  {
    pattern:
      /(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|pwd)(["']?\s*[:=]\s*["']?)[^\s"',;}]{4,}/gi,
    replace: "$1$2[已脱敏]",
  },
  // 常见提供方密钥前缀
  { pattern: /\bsk-[A-Za-z0-9._-]{8,}/g, replace: "[已脱敏]" },
]

/** 对任意错误文本/摘要做出口脱敏；非字符串原样返回（结构化调用方自行处理）。 */
export function redactSensitive(text) {
  if (typeof text !== "string" || text === "") return text
  let out = text
  for (const { pattern, replace } of PATTERNS)
    out = out.replace(pattern, replace)
  return out
}
