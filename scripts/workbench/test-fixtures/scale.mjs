// Reproducible acceptance data only. This fixture seeds valid historical rows in one
// transaction; it does not measure publication throughput or weaken production durability.
import { mkdir, writeFile, cp, stat, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { WorkbenchStore } from "../../../apps/workbench/src/server/notes/storage.mjs"
export async function createScaleFixture(directory, fontPath) {
  const root = resolve(directory)
  await mkdir(root, { recursive: true })
  if ((await readdir(root)).length)
    throw new Error("Scale fixture requires an empty owned directory")
  const actor = "scale-agent",
    kinds = ["markdown", "board", "ui"],
    stamp = new Date().toISOString()
  const store = new WorkbenchStore(join(root, "v2"))
  await store.open()
  try {
    const sources = {},
      templates = {},
      large = {}
    for (const kind of kinds) {
      for (const mode of ["small", "large"]) {
        const source = join(root, "sources", kind + "-" + mode)
        await mkdir(source, { recursive: true })
        sources[kind + "-" + mode] = source
        if (kind === "markdown") {
          const text =
            mode === "large"
              ? "这是规模验收的中文段落用于核对阅读与评论定位。".repeat(900)
              : "规模验收正文。"
          await writeFile(
            join(source, "document.md"),
            "# 规模文档\n\n" +
              text.match(/.{1,200}/gu).join("\n\n") +
              "\n\n重复词 😀 **跨标签** 重复词\n\n|甲|乙|\n|---|---|\n|单元格|😀内容|\n\n```js\nconst ready = true\n```\n\n![示意图](diagram.svg)"
          )
          await writeFile(
            join(source, "diagram.svg"),
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="#e2e8f0"/><text x="20" y="50">Scale diagram</text></svg>'
          )
        } else if (kind === "board") {
          const count = mode === "large" ? 99 : 1
          const nodes = [
            {
              id: "group",
              type: "group",
              x: -50,
              y: -50,
              width: 4100,
              height: 2600,
              label: "规模分组",
            },
            ...Array.from({ length: count }, (_, i) => ({
              id: "n" + i,
              type: "text",
              x: (i % 10) * 400,
              y: Math.floor(i / 10) * 250,
              width: 300,
              height: 180,
              text: `节点${i} 中文长文本 `.repeat(8),
            })),
          ]
          const edges = Array.from(
            { length: mode === "large" ? 150 : 0 },
            (_, i) => ({
              id: "e" + i,
              fromNode: "n" + (i % count),
              toNode: "n" + ((i + 1) % count),
              label: "流程" + i,
            })
          )
          await writeFile(
            join(source, "flow.canvas"),
            JSON.stringify({ nodes, edges })
          )
        } else {
          await writeFile(
            join(source, "preview.json"),
            JSON.stringify({
              routes: {
                "/": "index.html",
                "/details": "details.html",
                "/flow": "index.html",
              },
            })
          )
          const font =
            mode === "large"
              ? "@font-face{font-family:fixture;src:url('/font.woff2')}body{font-family:fixture,system-ui}"
              : "body{font-family:system-ui}"
          const html =
            '<!doctype html><html><meta charset="utf-8"><style>' +
            font +
            "body{padding:30px;background:#f8fafc;color:#172033}button,a{padding:12px;margin:10px}</style><h1>规模 UI 预览</h1><a href=\"/details\">详情页</a><a href=\"/flow\">声明SPA路由</a><button id=\"dialog\" onclick=\"document.querySelector('dialog').showModal()\">打开弹窗</button><dialog>动态设计<button onclick=\"this.parentElement.close()\">关闭</button></dialog><script>if(location.pathname==='/flow')document.querySelector('h1').textContent='规模 SPA 路由';document.documentElement.dataset.fixtureReady='true'</script></html>"
          await writeFile(join(source, "index.html"), html)
          await writeFile(
            join(source, "details.html"),
            html.replace("规模 UI 预览", "规模 UI 详情")
          )
          if (mode === "large") {
            await cp(fontPath, join(source, "font.woff2"))
            const files = await readdir(source)
            let remaining = 50 * 1024 * 1024
            for (const file of files)
              remaining -= (await stat(join(source, file))).size
            for (let i = 0; i < 495; i++) {
              const length = Math.floor(remaining / (495 - i))
              const value = JSON.stringify({ content: "x".repeat(length - 14) })
              if (Buffer.byteLength(value) !== length)
                throw new Error("JSON fixture byte budget mismatch")
              await writeFile(join(source, `data-${i}.json`), value)
              remaining -= length
            }
          }
        }
        const artifact = await store.stagePackage(source, kind, actor)
        ;(mode === "large" ? large : templates)[kind] = store.db
          .prepare("SELECT * FROM artifacts WHERE id=?")
          .get(artifact.artifactId)
      }
    }
    const projects = [],
      directories = [],
      drafts = [],
      versions = []
    for (let p = 0; p < 20; p++) {
      const project = {
        id: randomUUID(),
        name: `规模项目 ${String(p + 1).padStart(2, "0")}`,
      }
      projects.push(project)
      const dirs = []
      for (let d = 0; d < 10; d++) {
        const dir = {
          id: randomUUID(),
          projectId: project.id,
          parentId: d > 0 && d < 8 ? dirs[d - 1].id : null,
          name: `目录 ${d + 1}`,
        }
        dirs.push(dir)
        directories.push(dir)
      }
      for (let d = 0; d < 10; d++) {
        const index = p * 10 + d,
          kind = kinds[index % 3],
          draft = {
            id: randomUUID(),
            directoryId: dirs[d].id,
            projectId: project.id,
            kind,
            title: `规模 ${kind} ${index + 1}`,
          }
        drafts.push(draft)
        for (let sequence = 1; sequence <= 10; sequence++) {
          const template =
            index < 3 && sequence === 10 ? large[kind] : templates[kind]
          const id = randomUUID(),
            artifactId = randomUUID(),
            path = join(root, "v2", "artifacts", artifactId)
          await cp(template.path, path, { recursive: true })
          const version = {
            id,
            draftId: draft.id,
            sequence,
            artifactId,
            path,
            kind,
            fileCount: template.file_count,
            totalBytes: template.total_bytes,
          }
          versions.push(version)
          if (sequence === 10) draft.versionId = id
        }
      }
    }
    store.db.exec("BEGIN IMMEDIATE")
    try {
      const project = store.db.prepare(
        "INSERT INTO projects VALUES(?,?,?,?,?,NULL)"
      )
      const directory = store.db.prepare(
        "INSERT INTO directories VALUES(?,?,?,?,?,?,?,NULL)"
      )
      const draft = store.db.prepare(
        "INSERT INTO drafts(id,directory_id,kind,title,review_revision,metadata_revision,actor_id,request_key,created_at,updated_at) VALUES(?,?,?,?,60,0,?,?,?,?)"
      )
      const artifact = store.db.prepare(
        "INSERT INTO artifacts VALUES(?,?,?,'sealed',?,?,?,?)"
      )
      const version = store.db.prepare(
        "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?)"
      )
      const thread = store.db.prepare(
        "INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)"
      )
      const reply = store.db.prepare(
        "INSERT INTO replies VALUES(?,?,?,?,NULL,?,?)"
      )
      for (const p of projects)
        project.run(p.id, p.name, actor, "scale:" + p.id, stamp)
      for (const d of directories)
        directory.run(
          d.id,
          d.projectId,
          d.parentId,
          d.name,
          actor,
          "scale:" + d.id,
          stamp
        )
      for (const d of drafts)
        draft.run(
          d.id,
          d.directoryId,
          d.kind,
          d.title,
          actor,
          "scale:" + d.id,
          stamp,
          stamp
        )
      for (const v of versions) {
        artifact.run(
          v.artifactId,
          v.kind,
          v.path,
          v.fileCount,
          v.totalBytes,
          actor,
          stamp
        )
        version.run(
          v.id,
          v.draftId,
          v.sequence,
          v.artifactId,
          v.sequence - 1,
          actor,
          "scale:" + v.id,
          "规模历史样本",
          stamp
        )
      }
      for (const d of drafts)
        for (let i = 0; i < 25; i++) {
          const id = randomUUID(),
            author = i % 2 ? "scale-A" : "scale-B",
            resolved = i % 3 === 0
          thread.run(
            id,
            d.id,
            d.versionId,
            author,
            JSON.stringify({ kind: "document" }),
            resolved ? "resolved" : "open",
            stamp,
            resolved ? stamp : null,
            resolved ? "local-user" : null
          )
          for (let r = 0; r < 2; r++) {
            const rid = randomUUID()
            reply.run(
              rid,
              id,
              r ? "scale-B" : author,
              `规模意见 ${i} / 回复 ${r}`,
              "scale:" + rid,
              stamp
            )
          }
        }
      store.db.exec("COMMIT")
    } catch (error) {
      store.db.exec("ROLLBACK")
      throw error
    }
    // Populate real receipt identities using the existing migration owner, outside the measured window.
    store.migrateV2ToV3()
    const counts = {}
    for (const table of [
      "projects",
      "directories",
      "drafts",
      "versions",
      "threads",
      "replies",
    ])
      counts[table] = store.db
        .prepare(`SELECT COUNT(*) n FROM ${table}`)
        .get().n
    if (store.db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Invalid fixture references")
    for (const d of drafts.slice(0, 3))
      await store.readVersionContent(d.versionId)
    await store.backupNow()
    return {
      root,
      sources,
      projects,
      directories,
      drafts,
      counts,
      uiBytes: large.ui.total_bytes,
    }
  } finally {
    store.close()
  }
}
