import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export const projectRoot = fileURLToPath(new URL("../", import.meta.url))
export const nodeVersion = "24.16.0"
export const windowsTarget = "x86_64-pc-windows-msvc"
export const releaseRepository = "ANIAN0/nianagent"
export const updateEndpoint = `https://github.com/${releaseRepository}/releases/latest/download/latest.json`

export function packagingEnvironment() {
  const environment = { ...process.env }
  // 部署/依赖加载不需要发行私钥，避免传给后端运行时及其依赖。
  delete environment.TAURI_SIGNING_PRIVATE_KEY
  delete environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  return environment
}

export async function productVersion() {
  const configuration = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8"
    )
  )
  if (!/^\d+\.\d+\.\d+$/.test(configuration.version))
    throw new Error("正式发行版本必须是稳定 SemVer，例如 0.1.0")
  return configuration.version
}

export function updaterPublicKey() {
  const encoded = process.env.MOON_UPDATER_PUBLIC_KEY?.trim()
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error("缺少有效 MOON_UPDATER_PUBLIC_KEY；请配置发行公钥后构建")
  const lines = Buffer.from(encoded, "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/)
  const key = Buffer.from(lines[1] ?? "", "base64")
  if (
    lines.length !== 2 ||
    !lines[0].startsWith("untrusted comment:") ||
    key.length !== 42 ||
    key.subarray(0, 2).toString("ascii") !== "Ed"
  )
    throw new Error(
      "MOON_UPDATER_PUBLIC_KEY 必须是 Tauri signer 生成的公钥内容"
    )
  return encoded
}
