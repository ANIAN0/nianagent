import { appendFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { githubRequest } from "./github-release.mjs"
import { productVersion, releaseRepository } from "./release-settings.mjs"

export function releaseId(value) {
  if (!/^[1-9]\d*$/.test(value ?? "") || !Number.isSafeInteger(Number(value)))
    throw new Error("Release/工作流 ID 必须是安全范围内的正整数")
  return String(Number(value))
}

export async function uniqueDraft(id, version) {
  const tag = `v${version}`
  const matching = []
  for (let page = 1; ; page += 1) {
    const batch = await (
      await githubRequest(`/releases?per_page=100&page=${page}`)
    ).json()
    matching.push(...batch.filter((entry) => entry.tag_name === tag))
    if (batch.length < 100) break
  }
  const draft = matching[0]
  if (
    matching.length !== 1 ||
    String(draft.id) !== id ||
    !draft.draft ||
    draft.prerelease ||
    draft.published_at
  )
    throw new Error("本版本必须只对应指定的未公开稳定草稿")
  return draft
}

async function resume() {
  // 输入只经环境传递；手动恢复只能从当前仓库 main 执行。
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== releaseRepository ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !process.env.GITHUB_OUTPUT
  )
    throw new Error("草稿恢复只能从本仓库 main 的手动工作流执行")
  const id = releaseId(process.env.MOON_RELEASE_ID)
  const runId = releaseId(process.env.MOON_BUILD_RUN_ID)
  const version = await productVersion()
  const tag = `v${version}`
  await uniqueDraft(id, version)
  const run = await (await githubRequest(`/actions/runs/${runId}`)).json()
  const ref = await (await githubRequest(`/git/ref/tags/${tag}`)).json()
  let object = ref.object
  // annotated tag 指向 tag 对象，必须逐层剥离后比较实际构建 commit。
  for (let depth = 0; object.type === "tag" && depth < 8; depth += 1)
    object = (await (await githubRequest(`/git/tags/${object.sha}`)).json())
      .object
  if (
    object.type !== "commit" ||
    run.event !== "push" ||
    run.status !== "completed" ||
    run.path !== ".github/workflows/release-windows.yml" ||
    run.repository?.full_name !== releaseRepository ||
    run.head_repository?.full_name !== releaseRepository ||
    run.head_branch !== tag ||
    run.head_sha !== object.sha
  )
    throw new Error("原构建必须来自本仓库、本标签 commit 的正式发布工作流")
  const jobs = []
  for (let page = 1; ; page += 1) {
    const batch = (
      await (
        await githubRequest(
          `/actions/runs/${runId}/jobs?per_page=100&page=${page}`
        )
      ).json()
    ).jobs
    jobs.push(...batch)
    if (batch.length < 100) break
  }
  const releaseJobs = jobs.filter((job) => job.name === "release")
  const build = releaseJobs[0]?.steps.filter(
    (step) => step.name === "Build signed NSIS and upload complete assets"
  )
  if (
    releaseJobs.length !== 1 ||
    build?.length !== 1 ||
    build[0].conclusion !== "success"
  )
    throw new Error("原工作流必须已经成功完成唯一的正式签名构建与上传步骤")
  await appendFile(process.env.GITHUB_OUTPUT, `releaseId=${id}\ntag=${tag}\n`)
  console.info("原标签 commit 的正式签名构建已确认，复用该草稿资产继续验签")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await resume()
