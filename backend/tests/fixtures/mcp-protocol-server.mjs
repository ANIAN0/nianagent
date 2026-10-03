// Real stdio MCP transport fixture. No in-memory adapter or fake SDK methods.
import { createInterface } from "node:readline"
import { appendFileSync, readFileSync } from "node:fs"
import { resolve, relative, isAbsolute } from "node:path"
const root = resolve(process.argv[2])
const counter = process.argv[3]
const delay = Number(process.argv[4] || 0)
if (counter) appendFileSync(counter, `${process.pid}\n`)
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
input.on("line", async (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === "initialize") {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    reply(message.id, {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "moon-filesystem-fixture", version: "1.0.0" },
    })
  } else if (message.method === "tools/list")
    reply(message.id, {
      tools: [
        {
          name: "read_text",
          description: "读取此服务目录内的真实文本文件",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
        {
          name: "never_selected",
          description: "用于核对未选中工具不会暴露",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    })
  else if (message.method === "tools/call") {
    const path = resolve(root, message.params.arguments?.path || "")
    const inside = relative(root, path)
    if (
      message.params.name !== "read_text" ||
      inside.startsWith("..") ||
      isAbsolute(inside)
    )
      reply(message.id, {
        content: [{ type: "text", text: "路径或工具不可用" }],
        isError: true,
      })
    else {
      try {
        reply(message.id, {
          content: [{ type: "text", text: readFileSync(path, "utf8") }],
        })
      } catch {
        reply(message.id, {
          content: [{ type: "text", text: "文件不可读取" }],
          isError: true,
        })
      }
    }
  } else if (message.method === "ping") reply(message.id, {})
  else
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      }) + "\n"
    )
})
input.on("close", () => process.exit(0))
