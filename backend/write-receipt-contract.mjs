// Pure contract metadata is consumed by the API catalog in the browser.
export const writeOperations = ["save", "remove", "mcpSave", "mcpRemove", "extensionConfigure"]
const string = (description, extra = {}) => ({ type: "string", description, ...extra })
const ref = ($ref) => ({ $ref })
const object = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required })
export const writeRequestId = string("客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执", { minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" })
export const writeReceiptSchemas = {
  WriteReceipt: object({
    operationRequestId: writeRequestId,
    operation: string("原操作名", { enum: writeOperations }),
    targetId: string("原目标稳定标识；缺少回执时为空，不能猜测已提交"),
    state: string("committed 与业务数据同原子文件提交；rejected 未提交；unknown 不得盲重试", { enum: ["committed", "rejected", "unknown"] }),
    revision: { type: "integer", minimum: 0, description: "原操作完成时的目标版本，不等于当前最新版本" },
    issue: ref("OperationIssue"),
  }, ["operationRequestId", "operation", "targetId", "state"]),
}
export const writeReceiptOperations = {
  writeReceiptRead: {
    module: "操作回执", method: "writeReceipt", args: ["operation", "operationRequestId", "$signal"],
    request: object({ operation: string("原操作名", { enum: writeOperations }), operationRequestId: writeRequestId }),
    response: ref("WriteReceipt"), title: "核对原配置写入", input: ["operation", "operationRequestId"], result: "WriteReceipt",
    condition: "只读原持久操作身份；缺失返回unknown。旧宿主preparing表示没有业务提交；当前准备中不能推断失败。不会保存、删除或再次调用原操作。",
    errors: "无效身份、配置或回执文件损坏、读取失败。", effect: "只读；不写文件、不加载会话、不执行工具。",
    example: { operation: "save", operationRequestId: "original-operation" },
  },
}
