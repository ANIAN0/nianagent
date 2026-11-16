// @ts-check
/** 工作台 v2 共享错误类型（叶子模块，AC16）：storage 与 readers 共用，
 * 消除 readers→storage 的错误类依赖环；领域语义常量也不经 storage 反向引用。 */

/** 工作台领域错误：code 为对外明确分类（与 issue-contract 安全摘要同源）。 */
export class WorkbenchError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
