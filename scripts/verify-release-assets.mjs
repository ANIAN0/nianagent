import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve, basename } from "node:path"
import { spawnSync } from "node:child_process"
import {
  projectRoot,
  productVersion,
  releaseRepository,
  updaterPublicKey,
} from "./release-settings.mjs"
import { githubRequest, releaseAssets } from "./github-release.mjs"

updaterPublicKey()
const version = await productVersion()
const arguments_ = process.argv.slice(2)
const releaseId = arguments_[0] === "--release-id" ? arguments_[1] : null
if (releaseId && !/^\d+$/.test(releaseId)) throw new Error("无效 Release ID")
const directory = resolve(
  projectRoot,
  releaseId
    ? ".dev/release/verified-assets"
    : (arguments_[0] ?? ".dev/release/assets")
)
let assets = null
if (releaseId) {
  const release = await (await githubRequest(`/releases/${releaseId}`)).json()
  if (
    !release.draft ||
    release.prerelease ||
    release.tag_name !== `v${version}`
  )
    throw new Error("只验证与本次产品版本匹配的稳定草稿")
  await mkdir(directory, { recursive: true })
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("拒绝写入链接的资产目录")
  assets = await releaseAssets(releaseId)
  for (const asset of assets) {
    if (asset.name !== basename(asset.name) || /[\\/]/.test(asset.name))
      throw new Error("Release 资产名称不安全")
    if (
      asset.name === "latest.json" ||
      asset.name.endsWith("-setup.exe") ||
      asset.name.endsWith("-setup.exe.sig")
    ) {
      const response = await githubRequest(`/releases/assets/${asset.id}`, {
        headers: { Accept: "application/octet-stream" },
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length !== asset.size || bytes.length === 0)
        throw new Error("Release 资产不完整")
      await writeFile(resolve(directory, asset.name), bytes)
    }
  }
}
const manifest = JSON.parse(
  await readFile(resolve(directory, "latest.json"), "utf8")
)
if (manifest.version !== version)
  throw new Error("更新清单版本与产品版本不一致")
const platforms = manifest.platforms
const target =
  platforms?.["windows-x86_64-nsis"] ?? platforms?.["windows-x86_64"]
if (
  !target ||
  Object.keys(platforms).some(
    (key) => !["windows-x86_64", "windows-x86_64-nsis"].includes(key)
  )
)
  throw new Error("首期更新清单只能包含 Windows x64 NSIS")
if (
  platforms["windows-x86_64"] &&
  platforms["windows-x86_64-nsis"] &&
  (platforms["windows-x86_64"].url !== platforms["windows-x86_64-nsis"].url ||
    platforms["windows-x86_64"].signature !==
      platforms["windows-x86_64-nsis"].signature)
)
  throw new Error("兼容平台键必须指向同一个签名安装包")
const url = new URL(target.url)
const installer = decodeURIComponent(url.pathname.split("/").at(-1))
if (
  !installer.endsWith("_x64-setup.exe") ||
  !installer.includes(`_${version}_`) ||
  installer !== basename(installer) ||
  /[\\/]/.test(installer) ||
  target.url !==
    `https://github.com/${releaseRepository}/releases/download/v${version}/${encodeURIComponent(installer)}`
)
  throw new Error("更新清单必须使用本版本 tag 下精确的 Windows x64 NSIS 资产")
const signaturePath = resolve(directory, `${installer}.sig`)
const signature = (await readFile(signaturePath, "utf8")).trim()
if (target.signature !== signature)
  throw new Error("清单签名与已上传签名资产不一致")
if (assets) {
  const expectedAssets = ["latest.json", installer, `${installer}.sig`]
  if (
    assets.length !== expectedAssets.length ||
    assets.some((asset) => !expectedAssets.includes(asset.name))
  )
    throw new Error("草稿包含本次 Windows NSIS 发行之外的资产")
  for (const name of expectedAssets) {
    if (
      assets.filter(
        (asset) =>
          asset.name === name && asset.state === "uploaded" && asset.size > 0
      ).length !== 1
    )
      throw new Error(`草稿资产缺失或未完成：${name}`)
  }
}
const verify = spawnSync(
  "cargo",
  [
    "run",
    "--locked",
    "--manifest-path",
    "scripts/release-verifier/Cargo.toml",
    "--",
    resolve(directory, installer),
    signaturePath,
    version,
  ],
  { cwd: projectRoot, stdio: "inherit" }
)
if (verify.status !== 0) throw new Error("安装包真实签名或绑定版本验证失败")
console.info(`Moon ${version} 的安装包、签名和清单完整且对应，可发布草稿`)
