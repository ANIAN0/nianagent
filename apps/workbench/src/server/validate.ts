type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  enum?: unknown[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "object":
      return isPlainObject(value)
    case "array":
      return Array.isArray(value)
    case "string":
      return typeof value === "string"
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "boolean":
      return typeof value === "boolean"
    case "null":
      return value === null
    default:
      return false
  }
}

function collectErrors(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: string[]
) {
  if (errors.length >= 5) return

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!allowed.some((item) => matchesType(value, item))) {
      errors.push(`- ${path}: 类型须为 ${allowed.join(" 或 ")}`)
      return
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`- ${path}: 取值不在允许范围内`)
    return
  }

  if (typeof value === "string") {
    if (schema.minLength === undefined && schema.maxLength === undefined) return
    let length = 0
    for (let index = 0; index < value.length;) {
      index += value.codePointAt(index)! > 0xffff ? 2 : 1
      length++
      if (schema.maxLength !== undefined && length > schema.maxLength) break
      if (schema.maxLength === undefined && length >= (schema.minLength ?? 0))
        break
    }
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push(`- ${path}: 长度不能小于 ${schema.minLength}`)
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push(`- ${path}: 长度不能大于 ${schema.maxLength}`)
    }
    return
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`- ${path}: 数值不能小于 ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`- ${path}: 数值不能大于 ${schema.maximum}`)
    }
    return
  }

  if (Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length && errors.length < 5; i += 1) {
        collectErrors(schema.items, value[i], `${path}[${i}]`, errors)
      }
    }
    return
  }

  if (isPlainObject(value)) {
    const props = schema.properties ?? {}
    if (schema.required) {
      for (const key of schema.required) {
        if (errors.length >= 5) break
        if (!Object.hasOwn(value, key) || value[key] === undefined) {
          errors.push(
            `- ${path === "root" ? key : `${path}.${key}`}: 必填字段缺失`
          )
        }
      }
    }
    for (const [key, itemValue] of Object.entries(value)) {
      if (errors.length >= 5) break
      const childPath = path === "root" ? key : `${path}.${key}`
      if (Object.hasOwn(props, key)) {
        collectErrors(props[key], itemValue, childPath, errors)
      } else if (schema.additionalProperties === false) {
        errors.push(`- ${childPath}: 不允许额外字段`)
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        collectErrors(schema.additionalProperties, itemValue, childPath, errors)
      }
    }
  }
}

export function validatePluginValue(schema: unknown, value: unknown): unknown {
  const rootSchema = schema as JsonSchema | null | undefined
  if (
    !rootSchema ||
    rootSchema.type !== "object" ||
    rootSchema.additionalProperties !== false
  ) {
    throw new Error("插件操作须声明严格对象schema。")
  }
  const errors: string[] = []
  collectErrors(rootSchema, value, "root", errors)
  if (errors.length > 0) {
    const summary = errors.join("；").slice(0, 300)
    throw new Error(`输入不符合接口要求（${summary}）。`)
  }
  return value
}
