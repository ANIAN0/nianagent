import { useState } from "react"
import {
  ExtensionConfigurationFields,
  readExtensionConfiguration,
} from "./extension-configuration-fields"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  unsupported = false,
  disabled = false,
}: {
  unsupported?: boolean
  disabled?: boolean
}) {
  const [values, setValues] = useState<Record<string, unknown>>(
    unsupported
      ? { paths: ["notes"] }
      : { prefix: "moon", preview: true, limit: 3, tone: "plain" }
  )
  const { schema } = readExtensionConfiguration(
    JSON.stringify({
      type: "object",
      properties: unsupported
        ? { paths: { type: "array", title: "文件路径" } }
        : {
            prefix: {
              type: "string",
              title: "文字前缀",
              description: "来自扩展schema的说明",
              default: "moon",
              maxLength: 40,
            },
            preview: { type: "boolean", title: "显示预览" },
            limit: {
              type: "integer",
              title: "条目数量",
              minimum: 1,
              maximum: 8,
            },
            tone: {
              type: "string",
              title: "文本风格",
              enum: ["plain", "brief"],
            },
          },
      required: ["prefix"],
    }),
    JSON.stringify(values)
  )
  return (
    <div className="max-w-lg p-6">
      <ExtensionConfigurationFields
        id="catalog-extension"
        schema={schema}
        values={values}
        disabled={disabled}
        onChange={setValues}
      />
    </div>
  )
}
export default {
  id: "extension-configuration-fields",
  name: "扩展schema字段",
  layer: "复合组件",
  group: "会话配置",
  source: "src/features/extensions/extension-configuration-fields.tsx",
  description:
    "由正式JSON schema声明字段标题、说明、默认提示与原始类型；复杂结构保持可读。",
  boundary: "只编辑父级草稿，不写全局配置、不发起请求。",
  inputs: ["id", "schema", "values", "disabled"],
  events: ["onChange(values)"],
  composition: ["Field", "Input", "Switch", "Select", "Textarea"],
  consumers: ["ExtensionEditor"],
  viewport: { width: 580, height: 500 },
  states: [
    {
      id: "primitives",
      name: "基础字段",
      condition: "字符串、开关、整数、字符串枚举",
      expected: "类型不被转为统一字符串，约束和schema说明可见",
      render: () => <Example />,
    },
    {
      id: "disabled",
      name: "请求中",
      condition: "父级请求未结束",
      expected: "字段统一不可编辑",
      render: () => <Example disabled />,
    },
    {
      id: "unsupported",
      name: "复杂schema只读",
      condition: "schema有数组或复杂对象",
      expected: "诚实说明暂不支持表单编辑，原配置以JSON只读展示",
      render: () => <Example unsupported />,
    },
  ],
} satisfies CatalogEntry
