// 插件宿主共享纯 helpers（G16 拆分下沉）：宿主与共享工具网关共同消费，无状态、无 I/O。
import { resolve } from "node:path"

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
