import { logsOperations } from "./contract.mjs"
export async function activate(host) {
  const operation = (name, action) => ({
    ...logsOperations[name],
    execute: async (input, _context, signal) => {
      signal?.throwIfAborted()
      const value = await action(input)
      signal?.throwIfAborted()
      return { value }
    },
  })
  return {
    operations: {
      query: operation("query", (input) => host.logs.query(input)),
      detail: operation("detail", ({ id }) => host.logs.detail(id)),
    },
    status: () => host.logs.issue || "MCP 与对外工具日志",
    close() {},
  }
}
