import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation"
import { check } from "./plugin-primitives.mjs"

export {
  base64Image,
  check,
  identifier,
  jsonValue,
  safeError,
  samePath,
} from "./plugin-primitives.mjs"

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
