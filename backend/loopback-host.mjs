// @ts-check
// 内置插件本机回环托管的公共构件：token 身份、bearer 校验、一次性票据与 JSON 响应。
// Host/Origin 校验由各插件执行（MCP 使用官方 SDK 校验器），此处只沉淀双方重复的实现。
import { readFile } from "node:fs/promises"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { replaceJson } from "./atomic-file.mjs"

/** 读取并校验 43 字符 base64url token；缺失则生成并持久化。 */
export async function loadTokenIdentity(tokenFile, label) {
  let identity = null
  try {
    identity = JSON.parse(await readFile(tokenFile, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(`${label}配置无法读取，原文件已保留。`, { cause: error })
  }
  if (!identity) {
    identity = { token: randomBytes(32).toString("base64url") }
    await replaceJson(tokenFile, identity)
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(identity.token))
    throw new Error(`${label}token 文件无效，请保留原文件并修复。`)
  return identity
}

const sameBuffer = (supplied, expected) => {
  const left = Buffer.from(typeof supplied === "string" ? supplied : "")
  const right = Buffer.from(typeof expected === "string" ? expected : "")
  return (
    left.length > 0 &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  )
}

/** 校验 `Bearer <token>` 请求头（恒定时间比较）。 */
export const bearerAuthorized = (header, token) => {
  const match = /^Bearer (.+)$/.exec(header || "")
  return sameBuffer(match?.[1], token)
}

/** 一次性票据签发与校验：默认 30 秒单次有效，签名时顺带清理过期票据。 */
export function createTickets(ttlMs = 30_000) {
  const tickets = new Map()
  return {
    issue() {
      const now = Date.now()
      for (const [value, expires] of tickets)
        if (expires < now) tickets.delete(value)
      const value = randomBytes(32).toString("base64url")
      tickets.set(value, now + ttlMs)
      return value
    },
    /** 返回票据是否有效；无论有效与否都立刻消费。 */
    verify(value) {
      const expires = value ? tickets.get(value) : undefined
      tickets.delete(value)
      return Boolean(expires && expires >= Date.now())
    },
  }
}

/** 读取带兜底的 JSON 配置文件：缺失返回 fallback，损坏抛出保留原文的中文错误。 */
export async function readSavedJson(file, fallback, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return fallback
    throw new Error(`${label}配置无法读取，原文件已保留。`, { cause: error })
  }
}

export const sendJson = (res, status, value) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  res.end(JSON.stringify(value ?? {}))
}

/* 页面不外联：脚本与样式内联，数据只回本机 API；外部图片媒体按真实页面需要放行。 */
export const pageHeaders = (extra = {}) => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  ...extra,
})

export const moduleHeaders = {
  "content-type": "text/javascript; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
}
