// 插件宿主共享纯 helpers（G16 拆分下沉）：宿主与共享工具网关共同消费，无状态、无 I/O。
import { resolve } from "node:path"
import { validateToolArguments } from "@earendil-works/pi-ai"

export const identifier = /^[a-z][a-z0-9-]{0,63}$/

export const samePath = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  (process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b))

export const check = (value, message) => {
  if (!value) throw new Error(message)
}

export const base64Image = (data) =>
  typeof data === "string" &&
  data.length <= 16 * 1024 * 1024 &&
  data.length % 4 === 0 &&
  /^[A-Za-z0-9+/]*={0,2}$/.test(data)

export const jsonValue = (value, depth = 0) =>
  depth <= 32 &&
  (value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value)
      ? value.every((item) => jsonValue(item, depth + 1))
      : value &&
        typeof value === "object" &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Object.values(value).every((item) => jsonValue(item, depth + 1))))

export const safeError = (error) =>
  /[\u4e00-\u9fff]/u.test(error?.message || "")
    ? error.message
    : "插件操作失败，请核对来源并重新读取。"

export function validatePluginValue(schema, value) {
  check(
    schema?.type === "object" && schema.additionalProperties === false,
    "插件操作须声明严格对象schema。"
  )
  try {
    const validated = validateToolArguments(
      { name: "plugin", parameters: schema },
      { id: "validation", name: "plugin", arguments: structuredClone(value) }
    )
    check(
      JSON.stringify(validated) === JSON.stringify(value),
      "插件字段类型不符合声明。"
    )
    return value
  } catch (error) {
    // AC01/AC13-二轮：校验失败的原始消息携带完整入参回显（正文/属性/实现细节）。
    // 只保留校验路径摘要（字段级错误行），不回传 body。
    const detail = String(error?.message ?? "").split("\n\n")[0]
    const lines = detail
      .split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .slice(0, 5)
      .join("；")
    throw new Error(
      lines
        ? `输入不符合接口要求（${lines.slice(0, 300)}）。`
        : "输入不符合接口要求。",
      { cause: error }
    )
  }
}
