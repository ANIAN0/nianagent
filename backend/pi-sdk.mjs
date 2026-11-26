import { readFile } from "node:fs/promises"
// @ts-check
// Pi ships this SDK bundle beside its public unbundled entry. Resolve
// relative to the same installed package in dev and the packaged runtime.
/** @type {Promise<typeof import("@earendil-works/pi-coding-agent")> | undefined} */
let sdk

/** @returns {Promise<typeof import("@earendil-works/pi-coding-agent")>} */
export function loadPiSdk() {
  return (sdk ??= import(
    new URL(
      "./bundle/index.js",
      import.meta.resolve("@earendil-works/pi-coding-agent")
    ).href
  ))
}

let configReader
export async function loadPiMcpConfig(options) {
  if (!configReader) {
    const entry = import.meta.resolve("@earendil-works/pi-coding-agent")
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", entry), "utf8")
    )
    if (version !== "1.6.0")
      throw new Error("当前 Pi " + version + " 的 MCP 配置入口尚未适配。")
    const module = await import(
      new URL("./extensions/mcp/config.js", entry).href
    )
    if (typeof module.loadMcpConfig !== "function")
      throw new Error("Pi 安装缺少兼容的 MCP 配置读取入口。")
    configReader = module.loadMcpConfig
  }
  return configReader(options)
}
