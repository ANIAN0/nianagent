import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import {
  githubRequest,
  releaseAssets,
  uploadLatestManifest,
} from "./github-release.mjs"
import {
  productVersion,
  projectRoot,
  releaseRepository,
  updaterPublicKey,
} from "./release-settings.mjs"
import { releaseId, uniqueDraft } from "./validate-release-resume.mjs"

export function canonicalManifest(manifest, installer, version) {
  const canonical = `https://github.com/${releaseRepository}/releases/download/v${version}/${encodeURIComponent(installer.name)}`
  const api = `https://api.github.com/repos/${releaseRepository}/releases/assets/${installer.id}`
  if (manifest.version !== version) throw new Error("草稿清单版本不匹配")
  const entries = Object.entries(manifest.platforms ?? {})
  if (
    !entries.length ||
    entries.some(
      ([key, target]) =>
        !["windows-x86_64", "windows-x86_64-nsis"].includes(key) ||
        ![api, canonical].includes(target?.url)
    )
  )
    throw new Error("清单只能绑定本草稿已确认安装包 ID 的 API 或精确 tag URL")
  if (entries.some(([, target]) => target.url !== entries[0][1].url))
    throw new Error("兼容平台键必须指向同一个安装包")
  // tauri-action v1 使用 API asset URL；仅把已确认资产规范为公开 tag URL。
  return {
    ...manifest,
    platforms: Object.fromEntries(
      entries.map(([key, target]) => [key, { ...target, url: canonical }])
    ),
  }
}

async function normalize() {
  const version = await productVersion()
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== releaseRepository ||
    !(
      (process.env.GITHUB_EVENT_NAME === "push" &&
        process.env.GITHUB_REF_NAME === `v${version}`) ||
      (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        process.env.GITHUB_REF === "refs/heads/main")
    )
  )
    throw new Error("清单规范化仅用于正式 tag 或 main 草稿恢复工作流")
  updaterPublicKey()
  const id = releaseId(process.env.MOON_RELEASE_ID)
  const draft = await uniqueDraft(id, version)
  const assets = await releaseAssets(id)
  const installerName = `moon_${version}_x64-setup.exe`
  const expected = [installerName, `${installerName}.sig`, "latest.json"]
  if (
    ![2, 3].includes(assets.length) ||
    assets.some(
      (asset) =>
        !expected.includes(asset.name) ||
        asset.state !== "uploaded" ||
        asset.size <= 0
    ) ||
    expected
      .slice(0, 2)
      .some((name) => assets.filter((a) => a.name === name).length !== 1) ||
    assets.filter((asset) => asset.name === "latest.json").length > 1
  )
    throw new Error(
      "草稿只能包含本版本唯一完整的 Windows NSIS 安装包、签名和清单"
    )
  const directory = resolve(projectRoot, ".dev/release/normalized-assets")
  for (const path of [
    resolve(projectRoot, ".dev"),
    resolve(projectRoot, ".dev/release"),
    directory,
  ]) {
    await mkdir(path, { recursive: true })
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("拒绝写入链接资产目录")
  }
  for (const asset of assets) {
    const bytes = Buffer.from(
      await (
        await githubRequest(`/releases/assets/${asset.id}`, {
          headers: { Accept: "application/octet-stream" },
        })
      ).arrayBuffer()
    )
    if (bytes.length !== asset.size) throw new Error("草稿资产内容不完整")
    await writeFile(resolve(directory, asset.name), bytes)
  }
  const installer = assets.find((asset) => asset.name === installerName)
  const latest = assets.find((asset) => asset.name === "latest.json")
  const signature = (
    await readFile(resolve(directory, `${installerName}.sig`), "utf8")
  ).trim()
  // 上传响应中断后可能只留下签名包；恢复仍由真实签名/版本决定，绝不重建包。
  const original = latest
    ? JSON.parse(await readFile(resolve(directory, "latest.json"), "utf8"))
    : {
        version,
        notes: draft.body ?? "",
        pub_date: draft.created_at,
        platforms: {
          "windows-x86_64-nsis": {
            signature,
            url: `https://api.github.com/repos/${releaseRepository}/releases/assets/${installer.id}`,
          },
        },
      }
  const canonical = canonicalManifest(original, installer, version)
  const bytes = Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`)
  await writeFile(resolve(directory, "latest.json"), bytes)
  const check = spawnSync(
    process.execPath,
    ["scripts/verify-release-assets.mjs", directory],
    {
      cwd: projectRoot,
      stdio: "inherit",
    }
  )
  if (check.status !== 0)
    throw new Error("规范清单对应的实际安装包签名或可信版本无效")
  if (JSON.stringify(original) !== JSON.stringify(canonical) || !latest) {
    // 公开前再次确认状态及安装包 ID，只有未签名的 latest.json 可以替换。
    await uniqueDraft(id, version)
    const current = await releaseAssets(id)
    if (
      current.length !== assets.length ||
      current.some(
        (asset) =>
          !assets.some(
            (prior) =>
              prior.id === asset.id &&
              prior.name === asset.name &&
              prior.size === asset.size &&
              asset.state === "uploaded"
          )
      )
    )
      throw new Error("草稿资产发生并发变化，停止修改清单")
    if (latest)
      await githubRequest(`/releases/assets/${latest.id}`, { method: "DELETE" })
    await uploadLatestManifest(id, bytes)
  }
  console.info(
    "清单已绑定稳定 tag URL；安装包/签名保持原资产，仍须远端回读严格验签后发布"
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await normalize()
