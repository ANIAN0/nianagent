import assert from "node:assert/strict"
import test from "node:test"
import http from "node:http"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { activate } from "./host.mjs"

test("开发托管开放本机访问并保留Origin/Host与源码边界", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-host-dev-"))
  const reservation = http.createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  await writeFile(
    join(directory, "settings.json"),
    JSON.stringify({ revision: 0, port })
  )
  const previous = process.env.MOON_NOTES_DEV
  process.env.MOON_NOTES_DEV = "1"
  let plugin
  t.after(async () => {
    await plugin?.close()
    if (previous === undefined) delete process.env.MOON_NOTES_DEV
    else process.env.MOON_NOTES_DEV = previous
    await rm(directory, { recursive: true, force: true })
  })
  plugin = await activate({
    directory,
    diagnostics: { append() {} },
    isActive: () => true,
    logs: { append: async () => {} },
    lease: async (run) => run(),
  })
  const base = `http://127.0.0.1:${port}`
  const request = (path, options) =>
    fetch(base + path, { signal: AbortSignal.timeout(30000), ...options })
  const empty = await request("/")
  assert.equal(empty.status, 200)
  const html = await empty.text()
  assert.ok(html.includes("/src/main.tsx"))
  assert.ok(!html.includes("window.__moonNotesWorkbenchToken="))
  assert.ok(
    empty.headers
      .get("content-security-policy")
      .includes(`frame-src http://*.localhost:${port}`)
  )
  assert.equal(plugin.operations.reveal, undefined)
  // 换票路径在开发托管同样可用：票据换取注入 token 的外壳，长期 token 不进 URL。
  const issued = await plugin.operations.ticket.execute(
    {},
    { source: "local" },
    new AbortController().signal
  )
  assert.ok(issued.value.ticket)
  assert.ok(issued.value.url.includes(`?ticket=${issued.value.ticket}`))
  const ticketPage = await request(
    `/?ticket=${encodeURIComponent(issued.value.ticket)}`
  )
  assert.equal(ticketPage.status, 200)
  assert.ok(
    (await ticketPage.text()).includes("window.__moonNotesWorkbenchToken=")
  )
  assert.equal(
    (await request("/api/v2/list_projects", { method: "POST", body: "{}" }))
      .status,
    200
  )
  assert.equal(
    (
      await request("/api/v2/list_projects", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: "{}",
      })
    ).status,
    403
  )
  const initialSync = await (await request("/api/sync?version=0")).json()
  const waiting = request(`/api/sync?version=${initialSync.version}`)
  await plugin.operations.v2_create_project.execute(
    { name: "外部新增", requestKey: "sync-project" },
    { source: "mcp", actorId: "A" },
    new AbortController().signal
  )
  const changed = await (await waiting).json()
  assert.ok(changed.version > initialSync.version)
  const restartCursor = await (
    await request(`/api/sync?version=${changed.version + 100}`)
  ).json()
  assert.equal(restartCursor.version, changed.version)
  for (const chunked of [false, true, false, true]) {
    const response = await new Promise((resolve, reject) => {
      const body = "x".repeat(8 * 1024 * 1024 + 1)
      const req = http.request(
        base + "/api/v2/list_projects",
        {
          method: "POST",
          headers: chunked ? {} : { "content-length": Buffer.byteLength(body) },
        },
        (res) => {
          let text = ""
          res.on("data", (chunk) => {
            text += chunk
          })
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(text) })
          )
        }
      )
      req.on("error", reject)
      if (chunked) req.write(body)
      req.end(chunked ? undefined : body)
    })
    assert.equal(response.status, 413)
    assert.equal(response.body.code, "limit_exceeded")
    assert.equal(response.body.outcome, "rejected")
  }
  assert.equal(
    (
      await request("/api/v2/list_projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      })
    ).status,
    200
  )
  const source = await request("/src/main.tsx")
  assert.equal(source.status, 200)
  assert.ok(source.headers.get("content-type").includes("javascript"))
  await source.text()
  for (const path of ["/host.mjs", "/package.json"]) {
    const denied = await request(path)
    assert.equal(denied.status, 403)
    await denied.text()
  }
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(
      base,
      { headers: { host: `localhost:${port + 1}` } },
      (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode))
      }
    )
    req.on("error", reject)
  })
  assert.equal(wrongHostStatus, 403)

  const execute = async (name, input) =>
    (
      await plugin.operations[`v2_${name}`].execute(
        input,
        { source: "mcp", actorId: "A" },
        new AbortController().signal
      )
    ).value
  const project = await execute("create_project", {
    name: "预览隔离",
    requestKey: "preview-project",
  })
  const folder = await execute("create_directory", {
    projectId: project.id,
    name: "UI",
    requestKey: "preview-folder",
  })
  const draft = await execute("create_draft", {
    directoryId: folder.id,
    kind: "ui",
    title: "多页资源",
    requestKey: "preview-draft",
  })
  const sourceDir = join(directory, "source-ui")
  await mkdir(sourceDir)
  await writeFile(
    join(sourceDir, "preview.json"),
    JSON.stringify({
      routes: { "/": "index.html", "/details": "details.html" },
    })
  )
  await writeFile(
    join(sourceDir, "index.html"),
    '<html><head></head><body><img src="中文 图片.svg"></body></html>'
  )
  await writeFile(
    join(sourceDir, "details.html"),
    "<html><head></head><body>详情</body></html>"
  )
  await writeFile(
    join(sourceDir, "中文 图片.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  )
  const artifact = await execute("stage_package", { sourceDir, kind: "ui" })
  const published = await execute("publish_version", {
    draftId: draft.id,
    artifactId: artifact.artifactId,
    baseSequence: 0,
    requestKey: "preview-publish",
  })
  assert.equal(published.projectId, project.id)
  assert.equal(published.title, "多页资源")
  const publishedUrl = new URL(published.openUrl)
  assert.equal(publishedUrl.searchParams.get("ticket"), null)
  assert.ok(publishedUrl.hash.includes(published.versionId))
  assert.equal((await request(publishedUrl.pathname)).status, 200)
  const refreshed = await execute("open_version", {
    draftId: draft.id,
    versionId: published.versionId,
  })
  assert.equal(refreshed.openUrl, published.openUrl)
  const post = async (name, input) =>
    request(`/api/v2/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
  const opened = await (
    await post("preview_open", { versionId: published.versionId })
  ).json()
  const previewRequest = (path) =>
    new Promise((resolve, reject) => {
      http
        .get(
          base + path,
          { headers: { host: `${opened.sid}.localhost:${port}` } },
          (res) => {
            let body = ""
            res.on("data", (chunk) => {
              body += chunk
            })
            res.on("end", () =>
              resolve({ status: res.statusCode, headers: res.headers, body })
            )
          }
        )
        .on("error", reject)
    })
  assert.equal((await previewRequest("/")).status, 200)
  assert.equal((await previewRequest("/details")).status, 200)
  const unicode = await previewRequest(
    "/" + encodeURIComponent("中文 图片.svg")
  )
  assert.equal(unicode.status, 200)
  assert.ok(unicode.body.startsWith("<svg"))
  assert.equal((await previewRequest("/api/v2/list_projects")).status, 404)
  assert.notEqual((await previewRequest("/%2e%2e%2fsettings.json")).status, 200)
  const capture = {
    sid: opened.sid,
    versionId: published.versionId,
    page: "/",
    elements: [],
  }
  assert.equal((await post("preview_inventory", capture)).status, 200)
  assert.equal(
    (await post("preview_inventory", { ...capture, page: "/undeclared" }))
      .status,
    400
  )
  assert.equal(
    (await post("preview_inventory", { ...capture, elements: null })).status,
    400
  )
  assert.equal(
    (await post("preview_inventory", { ...capture, versionId: "wrong" }))
      .status,
    403
  )
  await writeFile(
    join(sourceDir, "index.html"),
    "<html><head></head><body>only-second-version</body></html>"
  )
  await writeFile(join(sourceDir, "only-second.txt"), "second")
  const nextArtifact = await execute("stage_package", { sourceDir, kind: "ui" })
  const nextVersion = await execute("publish_version", {
    draftId: draft.id,
    artifactId: nextArtifact.artifactId,
    baseSequence: 1,
    requestKey: "preview-second",
  })
  const second = await (
    await post("preview_open", { versionId: nextVersion.versionId })
  ).json()
  assert.notEqual(second.sid, opened.sid)
  assert.equal((await previewRequest("/only-second.txt")).status, 404)
  assert.ok(!(await previewRequest("/")).body.includes("only-second-version"))
  assert.equal(
    (await post("preview_inventory", { ...capture, sid: second.sid })).status,
    403
  )
  assert.equal(
    (
      await post("preview_close", {
        sid: opened.sid,
        versionId: published.versionId,
      })
    ).status,
    200
  )
  assert.notEqual((await previewRequest("/")).status, 200)
})
