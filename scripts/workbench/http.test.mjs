import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises"
import http from "node:http"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { WorkbenchStore } from "../../apps/workbench/src/server/notes/storage.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const app = join(root, "apps", "workbench")

test(
  "Next 工作台 HTTP：编辑、协作、回读、同步和隔离预览",
  { timeout: 120_000 },
  async (t) => {
    const dev = join(root, ".dev")
    await mkdir(dev, { recursive: true })
    const directory = resolve(await mkdtemp(join(dev, "notes-http-")))
    assert.equal(dirname(directory), dev)
    let server
    t.after(async () => {
      if (
        server?.pid &&
        server.exitCode === null &&
        server.signalCode === null
      ) {
        const stopped = once(server, "exit")
        if (process.platform === "win32") {
          await once(
            spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
              windowsHide: true,
            }),
            "exit"
          )
        } else {
          process.kill(-server.pid, "SIGTERM")
        }
        await stopped
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 5 })
    })
    const reservation = http.createServer()
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
    const { port } = reservation.address()
    await new Promise((resolve) => reservation.close(resolve))
    const dataDir = join(directory, "data")
    // Simulate the schema from before draft consensus was added.
    const oldStore = new WorkbenchStore(join(dataDir, "v2"))
    await oldStore.open()
    let oldDraft
    try {
      const project = oldStore.createProject(
        "既有项目",
        "local-user",
        "old-project"
      )
      const folder = oldStore.createDirectory(
        project.id,
        null,
        "既有目录",
        "local-user",
        "old-folder"
      )
      oldDraft = oldStore.createDraft(
        folder.id,
        "markdown",
        "既有草稿",
        "local-user",
        "old-draft"
      )
    } finally {
      oldStore.close()
    }
    const oldDb = new DatabaseSync(join(dataDir, "v2", "workbench.db"))
    try {
      oldDb.exec("ALTER TABLE drafts DROP COLUMN consensus_status")
    } finally {
      oldDb.close()
    }
    server = spawn(
      process.execPath,
      [
        join(app, "node_modules", "next", "dist", "bin", "next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: app,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          PORT: String(port),
          MOON_NOTES_DATA_DIR: dataDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    let output = ""
    for (const stream of [server.stdout, server.stderr]) {
      stream.on("data", (chunk) => {
        output = (output + chunk).slice(-8000)
      })
    }
    const base = `http://127.0.0.1:${port}`
    const request = (path, options) =>
      fetch(base + path, { signal: AbortSignal.timeout(30_000), ...options })
    const post = (name, input, headers = {}) =>
      request(`/api/v2/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(input),
      })
    const execute = async (name, input, headers) => {
      const response = await post(name, input, headers)
      const body = await response.json()
      assert.equal(response.status, 200, JSON.stringify(body))
      return body
    }
    let ready = false
    for (let attempt = 0; attempt < 80 && server.exitCode === null; attempt++) {
      const response = await request("/api/health", {
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null)
      if (response?.ok) {
        const health = await response.json()
        assert.equal(health.app, "moon-workbench")
        assert.equal(health.dataDirs.notes, dataDir)
        ready = true
        break
      }
      await delay(250)
    }
    assert.ok(ready, output)

    const landing = await request("/", { redirect: "manual" })
    assert.equal(landing.status, 307)
    assert.equal(landing.headers.get("location"), "/notes")
    const page = await request("/notes")
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /moon 工作台/)
    assert.ok(!html.includes("window.__moonNotesWorkbenchToken"))
    assert.equal((await post("list_projects", {}, {})).status, 200)

    assert.equal(page.headers.get("set-cookie"), null)
    const browser = { origin: base }
    const migratedDraft = (
      await execute("list_drafts", {}, browser)
    ).items.find(({ id }) => id === oldDraft.id)
    assert.equal(migratedDraft.title, "既有草稿")
    assert.equal(migratedDraft.consensusStatus, "discussing")
    assert.equal(
      (await post("list_projects", {}, { origin: "https://example.invalid" }))
        .status,
      403
    )
    assert.equal((await request("/host.mjs")).status, 404)

    const initialSync = await (
      await request("/api/sync", { headers: browser })
    ).json()
    const waiting = request(`/api/sync?version=${initialSync.version}`, {
      headers: browser,
    })
    const notes = await execute(
      "create_project",
      { name: "编辑验收", requestKey: "edit-project" },
      browser
    )
    const changed = await (await waiting).json()
    assert.ok(changed.version > initialSync.version)
    const restartCursor = await (
      await request(`/api/sync?version=${changed.version + 100}`, {
        headers: browser,
      })
    ).json()
    assert.equal(restartCursor.version, changed.version)

    for (const chunked of [false, true]) {
      const response = await new Promise((resolve, reject) => {
        const body = "x".repeat(8 * 1024 * 1024 + 1)
        const req = http.request(
          base + "/api/v2/list_projects",
          {
            method: "POST",
            headers: {
              ...(chunked ? {} : { "content-length": Buffer.byteLength(body) }),
            },
          },
          (res) => {
            let text = ""
            res.setEncoding("utf8")
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

    const folderForEdits = await execute(
      "create_directory",
      {
        projectId: notes.id,
        name: "草稿",
        requestKey: "edit-directory",
      },
      browser
    )
    const markdownDraft = await execute(
      "create_draft",
      {
        directoryId: folderForEdits.id,
        kind: "markdown",
        title: "协作文档",
        requestKey: "edit-markdown",
      },
      browser
    )
    const boardDraft = await execute(
      "create_draft",
      {
        directoryId: folderForEdits.id,
        kind: "board",
        title: "协作白板",
        requestKey: "edit-board",
      },
      browser
    )
    const markdown = {
      draftId: markdownDraft.id,
      kind: "markdown",
      baseSequence: 0,
      markdown: "# 第一版\n\n**讨论**",
      requestKey: "edit-markdown-v1",
    }
    const first = await execute("publish_inline", markdown, browser)
    assert.equal(first.sequence, 1)
    assert.equal(first.replayed, false)
    const beforeArtifacts = await readdir(join(dataDir, "v2", "artifacts"))
    const replay = await execute("publish_inline", markdown, browser)
    assert.equal(replay.versionId, first.versionId)
    assert.equal(replay.replayed, true)
    const reused = await post(
      "publish_inline",
      { ...markdown, markdown: "# 改写" },
      browser
    )
    assert.equal((await reused.json()).code, "request_key_conflict")
    const stale = await post(
      "publish_inline",
      { ...markdown, requestKey: "edit-stale" },
      browser
    )
    assert.equal((await stale.json()).code, "version_conflict")
    assert.deepEqual(
      await readdir(join(dataDir, "v2", "artifacts")),
      beforeArtifacts
    )

    const secondInput = {
      ...markdown,
      baseSequence: 1,
      markdown: "# 第二版\n\n新内容",
      requestKey: "edit-markdown-v2",
    }
    const concurrent = await Promise.all([
      execute("publish_inline", secondInput, browser),
      execute("publish_inline", secondInput, browser),
    ])
    const [second] = concurrent
    assert.deepEqual(concurrent.map((item) => item.replayed).sort(), [
      false,
      true,
    ])
    assert.equal(concurrent[1].versionId, second.versionId)
    assert.equal(
      (await readdir(join(dataDir, "v2", "artifacts"))).length,
      beforeArtifacts.length + 1
    )
    for (const [receipt, input] of [
      [first, markdown],
      [second, secondInput],
    ]) {
      const content = await execute(
        "read_version",
        { draftId: input.draftId, versionId: receipt.versionId },
        browser
      )
      assert.equal(content.rawMarkdown, input.markdown)
      assert.equal(content.sequence, receipt.sequence)
    }
    const listed = await execute(
      "list_versions",
      { draftId: markdownDraft.id },
      browser
    )
    assert.deepEqual(
      listed.items.map(({ sequence }) => sequence),
      [2, 1]
    )

    const canvas = {
      nodes: [
        {
          id: "node",
          type: "text",
          x: 0,
          y: 0,
          width: 160,
          height: 100,
          text: "白板内容",
        },
      ],
      edges: [],
    }
    const board = await execute(
      "publish_inline",
      {
        draftId: boardDraft.id,
        kind: "board",
        baseSequence: 0,
        canvas,
        requestKey: "edit-board-v1",
      },
      browser
    )
    const boardRead = await execute(
      "read_version",
      { draftId: boardDraft.id, versionId: board.versionId },
      browser
    )
    assert.equal(boardRead.canvas.nodes[0].text, "白板内容")
    const consensus = await execute(
      "update_draft",
      {
        draftId: markdownDraft.id,
        consensusStatus: "pending_confirm",
        metadataRevision: 0,
        requestKey: "edit-consensus",
      },
      browser
    )
    assert.equal(consensus.metadataRevision, 1)
    const drafts = await execute(
      "list_drafts",
      { projectId: notes.id },
      browser
    )
    assert.equal(
      drafts.items.find(({ id }) => id === markdownDraft.id).consensusStatus,
      "pending_confirm"
    )
    const comment = await execute(
      "create_thread",
      {
        versionId: first.versionId,
        target: { kind: "document" },
        body: "请补充修改说明",
        requestKey: "edit-comment",
      },
      browser
    )
    await execute(
      "add_reply",
      {
        threadId: comment.threadId,
        relatedVersionId: second.versionId,
        body: "已更新",
        requestKey: "edit-reply",
      },
      { "x-moon-source": "mcp", "x-moon-actor": "test-agent" }
    )
    await execute(
      "set_thread_status",
      {
        threadId: comment.threadId,
        status: "resolved",
        requestKey: "edit-resolve",
      },
      browser
    )
    const thread = await execute(
      "read_thread",
      { threadId: comment.threadId },
      browser
    )
    assert.equal(thread.thread.status, "resolved")
    assert.equal(thread.replies.items.at(-1).body, "已更新")

    t.diagnostic(
      JSON.stringify({
        markdownDraft: markdownDraft.id,
        markdownVersions: concurrent.map(
          ({ versionId, sequence, replayed }) => ({
            versionId,
            sequence,
            replayed,
          })
        ),
        boardVersion: board.versionId,
        consensus: consensus.consensusStatus,
        review: { id: comment.threadId, status: thread.thread.status },
      })
    )
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
    assert.equal(publishedUrl.pathname, "/notes")
    assert.equal(publishedUrl.searchParams.get("ticket"), null)
    assert.ok(publishedUrl.hash.includes(published.versionId))
    assert.equal((await request(publishedUrl.pathname)).status, 200)
    const refreshed = await execute("open_version", {
      draftId: draft.id,
      versionId: published.versionId,
    })
    assert.equal(refreshed.openUrl, published.openUrl)
    const opened = await (
      await post("preview/open", { versionId: published.versionId })
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
    assert.notEqual(
      (await previewRequest("/%2e%2e%2fsettings.json")).status,
      200
    )
    const capture = {
      sid: opened.sid,
      versionId: published.versionId,
      page: "/",
      elements: [],
    }
    assert.equal((await post("preview/inventory", capture)).status, 200)
    assert.equal(
      (await post("preview/inventory", { ...capture, page: "/undeclared" }))
        .status,
      400
    )
    assert.equal(
      (await post("preview/inventory", { ...capture, elements: null })).status,
      400
    )
    assert.equal(
      (await post("preview/inventory", { ...capture, versionId: "wrong" }))
        .status,
      403
    )
    await writeFile(
      join(sourceDir, "index.html"),
      "<html><head></head><body>only-second-version</body></html>"
    )
    await writeFile(join(sourceDir, "only-second.txt"), "second")
    const nextArtifact = await execute("stage_package", {
      sourceDir,
      kind: "ui",
    })
    const nextVersion = await execute("publish_version", {
      draftId: draft.id,
      artifactId: nextArtifact.artifactId,
      baseSequence: 1,
      requestKey: "preview-second",
    })
    const secondPreview = await (
      await post("preview/open", { versionId: nextVersion.versionId })
    ).json()
    assert.notEqual(secondPreview.sid, opened.sid)
    assert.equal((await previewRequest("/only-second.txt")).status, 404)
    assert.ok(!(await previewRequest("/")).body.includes("only-second-version"))
    assert.equal(
      (await post("preview/inventory", { ...capture, sid: secondPreview.sid }))
        .status,
      403
    )
    assert.equal(
      (
        await post("preview/close", {
          sid: opened.sid,
          versionId: published.versionId,
        })
      ).status,
      200
    )
    assert.notEqual((await previewRequest("/")).status, 200)
    t.diagnostic(
      JSON.stringify({
        projectId: project.id,
        draftId: draft.id,
        previewVersion: published.versionId,
        nextVersion: nextVersion.versionId,
        openUrl: published.openUrl,
        routes: ["/", "/details", "/中文 图片.svg"],
      })
    )
  }
)
