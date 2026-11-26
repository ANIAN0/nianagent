import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { parse } from "smol-toml"
import { readLocal, targets } from "./inspect.mjs"

function userFile(client) {
  switch (client) {
    case "Codex":
      return join(
        process.env.CODEX_HOME || join(homedir(), ".codex"),
        "config.toml"
      )
    case "Claude Code":
      return join(homedir(), ".claude.json")
    case "Antigravity":
      return join(homedir(), ".gemini", "antigravity", "mcp_config.json")
    default:
      throw new Error("未知客户端。")
  }
}
function servers(client, raw) {
  if (raw === null) return {}
  const doc =
    client === "Codex"
      ? parse(raw.replace(/^\uFEFF/, ""))
      : JSON.parse(raw.replace(/^\uFEFF/, ""))
  const entries = doc[client === "Codex" ? "mcp_servers" : "mcpServers"] ?? {}
  if (!entries || typeof entries !== "object" || Array.isArray(entries))
    throw new Error("服务配置格式无效。")
  return entries
}
export async function globalSources(host) {
  const rows = await Promise.all(
    Object.keys(targets).map(async (client) => {
      try {
        let path, names
        if (client === "Moon / Pi") {
          const result = await host.mcp.personal()
          path = result.path
          names = result.names
        } else {
          path = userFile(client)
          names = Object.keys(
            servers(client, await readLocal(dirname(path), basename(path)))
          )
        }
        return {
          items: names.map((name) => ({
            name,
            path,
            client,
            scope: "personal",
            state: "unverified",
          })),
        }
      } catch {
        return { items: [], error: client + " 个人配置无法检查" }
      }
    })
  )
  return {
    items: rows.flatMap((row) => row.items),
    error: rows
      .map((row) => row.error)
      .filter(Boolean)
      .join("；"),
  }
}
export async function importDefinition(host, root, client, entryName, signal) {
  const map = servers(client, await readLocal(root, targets[client]))
  if (!Object.hasOwn(map, entryName)) throw new Error("条目已变化。")
  const entry = map[entryName]
  if (
    !entry ||
    typeof entry !== "object" ||
    Object.keys(entry).some(
      (key) => !["command", "args", "type", "url", "serverUrl"].includes(key)
    ) ||
    (entry.type && !["http", "stdio", "streamable-http"].includes(entry.type))
  )
    throw new Error(
      "此条目含认证或客户端专属选项，请在定义库手工登记兼容字段。"
    )
  return host.mcp.saveDefinition(
    {
      name: entryName,
      command: entry.command ?? "",
      args: entry.args ?? [],
      url: entry.url ?? entry.serverUrl ?? "",
    },
    signal
  )
}
