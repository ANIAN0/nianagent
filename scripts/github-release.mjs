import { releaseRepository } from "./release-settings.mjs"

export async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GitHub 发行操作缺少 GITHUB_TOKEN")
  const response = await fetch(
    `https://api.github.com/repos/${releaseRepository}${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
      signal: AbortSignal.timeout(60_000),
    }
  )
  if (!response.ok)
    throw new Error(`GitHub 发行 API 请求失败（HTTP ${response.status}）`)
  return response
}

export async function releaseAssets(releaseId) {
  const assets = []
  for (let page = 1; ; page += 1) {
    const batch = await (
      await githubRequest(
        `/releases/${releaseId}/assets?per_page=100&page=${page}`
      )
    ).json()
    assets.push(...batch)
    if (batch.length < 100) return assets
  }
}
