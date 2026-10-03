import type { CatalogEntry } from "../../ui-catalog/catalog"
import { SchemaFieldTable } from "./schema-field-table"
import { CatalogPreview } from "./catalog-fixtures"
import { operations, schemas } from "../../backend/contract.mjs"

export default {
  id: "api-schema-field-table",
  name: "契约字段表",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/schema-field-table.tsx",
  description:
    "读取正式 Schema，递归呈现 ref、数组、对象、anyOf 与 null，同时显示各字段约束。",
  boundary:
    "不是另一个校验器；只读文档。循环引用明确停止，字段必填相对于所属对象。",
  inputs: ["schema", "schemas", "label"],
  events: ["搜索字段/类型/说明", "字段区域滚动"],
  composition: ["InputGroup", "Table"],
  consumers: ["OperationDocs"],
  viewport: { width: 640, height: 640 },
  states: [
    {
      id: "union",
      name: "联合与空值",
      condition: "读取配置返回 SessionConfiguration|null",
      expected: "root union、两个方案及非空对象字段全部可读。",
      render: () => (
        <CatalogPreview>
          <SchemaFieldTable
            schema={operations.sessionRead.response}
            schemas={schemas}
            label="返回"
          />
        </CatalogPreview>
      ),
    },
    {
      id: "constraints",
      name: "请求约束",
      condition: "应用配置请求",
      expected:
        "revision 可选、字符串长度、数组上限、枚举与额外字段约束均呈现。",
      render: () => (
        <CatalogPreview>
          <SchemaFieldTable
            schema={operations.sessionApply.request}
            schemas={schemas}
            label="请求"
          />
        </CatalogPreview>
      ),
    },
  ],
} satisfies CatalogEntry
