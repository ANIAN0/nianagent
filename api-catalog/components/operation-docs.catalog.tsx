import type { CatalogEntry } from "../../ui-catalog/catalog"
import { OperationDocs } from "./operation-docs"
import { CatalogPreview } from "./catalog-fixtures"
import { operations, schemas } from "../../backend/contract.mjs"

export default {
  id: "api-operation-docs",
  name: "接口契约文档",
  layer: "复合组件",
  group: "接口目录",
  source: "api-catalog/components/operation-docs.tsx",
  description: "将行为、调用约束、错误恢复和请求/响应/错误字段按任务顺序展示。",
  boundary:
    "OperationDefinition 与 Schema 均来自正式 contract.mjs；浏览文档不会发起业务请求。",
  inputs: ["operation", "definition", "schemas"],
  events: ["切换请求/返回/错误字段", "字段搜索", "复制接口标识"],
  composition: ["Badge", "Button", "SchemaFieldTable", "CopyButton"],
  consumers: ["ApiCatalogApp"],
  viewport: { width: 680, height: 800 },
  states: [
    {
      id: "read",
      name: "可空返回",
      condition: "sessionRead 正式契约",
      expected: "切换返回字段可读到 SessionConfiguration|null，所有分支保留。",
      render: () => (
        <CatalogPreview>
          <OperationDocs
            operation="sessionRead"
            definition={operations.sessionRead}
            schemas={schemas}
          />
        </CatalogPreview>
      ),
    },
    {
      id: "write",
      name: "保存约束",
      condition: "sessionApply 正式契约",
      expected:
        "版本/原子提交/取消边界在字段之前可见；错误字段来自RpcFailure，结果待确认必须先核对。",
      render: () => (
        <CatalogPreview>
          <OperationDocs
            operation="sessionApply"
            definition={operations.sessionApply}
            schemas={schemas}
          />
        </CatalogPreview>
      ),
    },
  ],
} satisfies CatalogEntry
