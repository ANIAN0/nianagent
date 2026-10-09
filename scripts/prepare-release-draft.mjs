import { appendFile } from "node:fs/promises"
import { productVersion, releaseRepository } from "./release-settings.mjs"
import { githubRequest } from "./github-release.mjs"

// 任何远端写入之前确认正式 tag 工作流，误调用不能先创建草稿再报错。
if (
  !process.env.GITHUB_OUTPUT ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_EVENT_NAME !== "push" ||
  process.env.GITHUB_REF_TYPE !== "tag" ||
  process.env.GITHUB_REPOSITORY !== releaseRepository
)
  throw new Error("此命令仅用于本仓库的 GitHub tag 发布工作流")
const version = await productVersion()
const tag = `v${version}`
if (process.env.GITHUB_REF_NAME !== tag)
  throw new Error("发布工作流只能处理与产品版本一致的 tag")
let release
for (let page = 1; ; page += 1) {
  const batch = await (
    await githubRequest(`/releases?per_page=100&page=${page}`)
  ).json()
  release = batch.find((entry) => entry.tag_name === tag)
  if (release || batch.length < 100) break
}
if (release && !release.draft)
  throw new Error("该版本已公开发布，禁止覆盖正在分发的更新；请使用新版本")
if (!release)
  release = await (
    await githubRequest("/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: `Moon ${version}`,
        draft: true,
        prerelease: false,
        generate_release_notes: true,
      }),
    })
  ).json()
if (release.prerelease) throw new Error("稳定发行不能复用预发布草稿")
await appendFile(process.env.GITHUB_OUTPUT, `releaseId=${release.id}\n`)
console.info(`已准备 ${tag} 草稿；完整验证前不会公开发布`)
