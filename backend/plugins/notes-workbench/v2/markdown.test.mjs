// @ts-check
// Markdown 管线与比较回归测试（实现方案 §11 R2：Q04/Q06/Q07-URL/Q08-冻结表示 反例固化）。
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  parseBlocks,
  resolveAnchor,
  resolveCrossBlock,
  snapshotAnchor,
  InvalidAnchorError,
  generateReading,
  READING_PIPELINE_VERSION,
  safeUrl,
} from "./markdown.mjs"
import { WorkbenchStore, WorkbenchError } from "./storage.mjs"
import { createV2Service } from "./service.mjs"

const anchorCode = (error) =>
  error instanceof InvalidAnchorError && error.reason
const workbenchCode = (error) => error instanceof WorkbenchError && error.code

test("实体只解码普通正文，代码与原始HTML保持原文；非文本块不丢失", () => {
  assert.equal(parseBlocks("a &amp; &#x1F600; &copy;")[0].text, "a & 😀 ©")
  assert.equal(parseBlocks("`&amp;`")[0].text, "&amp;")
  assert.equal(parseBlocks("<b>&amp;</b>")[0].text, "<b>&</b>")
  assert.equal(parseBlocks("<div>&amp;</div>")[0].text, "<div>&amp;</div>")
  assert.equal(parseBlocks("---")[0].type, "hr")
  assert.equal(parseBlocks("![](x.png)")[0].html.includes("<img"), true)
})

test("URL净化拒绝浏览器会折叠的控制字符协议", () => {
  for (const url of [
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\rscript:alert(1)",
  ]) {
    assert.equal(new URL(url, "http://localhost").protocol, "javascript:")
    assert.equal(safeUrl(url), null)
    assert.equal(safeUrl(url, { image: true }), null)
  }
})

test("空表格单元格保留列位置和分隔符", () => {
  const [table] = parseBlocks(
    "| a | b |\n| --- | --- |\n| | tail |\n| head | |"
  )
  assert.equal(table.text, "a | b\n | tail\nhead | ")
  assert.equal(
    snapshotAnchor(resolveAnchor([table], { block: 0, exact: "tail" }), [table])
      .start,
    9
  )
})

// ---- Q04：码点坐标（emoji）----

test("Q04 emoji 块内偏移按码点计算，快照引文精确", () => {
  const blocks = parseBlocks("😀abc 尾部\n")
  const resolved = resolveAnchor(blocks, { block: 0, exact: "abc" })
  assert.equal(
    resolved.start,
    1,
    "😀 占 1 个码点，abc 起点是 1 而非 UTF-16 的 2"
  )
  assert.equal(resolved.end, 4)
  const anchor = snapshotAnchor(resolved, blocks)
  assert.equal(anchor.quote, "abc", "快照引文不得因 UTF-16 偏移错位")
})

test("Q04 emoji 出现在引文中间时长度按码点", () => {
  const blocks = parseBlocks("前缀🚀后缀继续\n")
  const resolved = resolveAnchor(blocks, { block: 0, exact: "🚀后缀" })
  const anchor = snapshotAnchor(resolved, blocks)
  assert.equal(anchor.quote, "🚀后缀")
  assert.equal(anchor.start, 2)
  assert.equal(anchor.end, 5)
})

// ---- Q04：DOM 文本投影（行内格式与实体）----

test("Q04 投影为 DOM 文本：行内格式剥离、实体还原", () => {
  const blocks = parseBlocks(
    "hello **bold** & world [link](https://example.com)\n"
  )
  assert.equal(blocks[0].text, "hello bold & world link")
})

test("Q04 表格/列表/引用/代码块投影与渲染 DOM 一致", () => {
  const md = [
    "| a | b |",
    "| --- | --- |",
    "| **x** | [y](https://e.com) |",
    "",
    "- 一 **加粗**",
    "- 二 `code`",
    "",
    "> 引用 **文字**",
    "",
    "```js",
    "const a = 1 & 2;",
    "```",
    "",
    "## 标题 **强调**",
  ].join("\n")
  const blocks = parseBlocks(md)
  const table = blocks.find((block) => block.type === "table")
  assert.equal(table.text, "a | b\nx | y")
  const list = blocks.find((block) => block.type === "list")
  assert.equal(list.text, "一 加粗\n二 code")
  const quote = blocks.find((block) => block.type === "blockquote")
  assert.equal(quote.text, "引用 文字")
  const code = blocks.find((block) => block.type === "code")
  assert.equal(code.text, "const a = 1 & 2;")
  const heading = blocks.find((block) => block.type === "heading")
  assert.equal(heading.text, "标题 强调")
})

test("Q04 重复段落由块索引消歧；块内重复无上下文报 ambiguous", () => {
  const blocks = parseBlocks("# 标题\n\n第一段。\n\n第一段。\n")
  const first = resolveAnchor(blocks, { block: 1, exact: "第一段。" })
  const second = resolveAnchor(blocks, { block: 2, exact: "第一段。" })
  assert.equal(first.block, 1)
  assert.equal(second.block, 2)
  assert.throws(
    () =>
      resolveAnchor(blocks, { block: 1, exact: "第一段。", suffix: "重复" }),
    (error) => anchorCode(error) === "not_found"
  )
})

test("Q04 块内重复文本用前缀消歧到正确码点位", () => {
  const blocks = parseBlocks("同同不同\n")
  const resolved = resolveAnchor(blocks, {
    block: 0,
    exact: "同",
    prefix: "同",
  })
  const anchor = snapshotAnchor(resolved, blocks)
  assert.equal(anchor.start, 1)
  assert.equal(anchor.quote, "同")
})

// ---- Q04：跨块连续选择 ----

test("Q04 跨块连续选择解析并携带各段快照（含块尾覆盖）", () => {
  const blocks = parseBlocks("# 标题\n\n第一段。\n\n第二段。\n")
  const resolved = resolveCrossBlock(blocks, [
    { block: 1, exact: "第一段。" },
    { block: 2, exact: "第二段。" },
  ])
  const anchor = snapshotAnchor(resolved, blocks)
  assert.equal(anchor.segments.length, 2)
  assert.equal(anchor.segments[0].quote, "第一段。")
  assert.equal(anchor.segments[1].quote, "第二段。")
})

test("Q04 跨块不连续/未到块尾明确拒绝", () => {
  const blocks = parseBlocks("# 标题\n\n第一段。\n\n第二段。\n")
  assert.throws(
    () =>
      resolveCrossBlock(blocks, [
        { block: 1, exact: "第一段" },
        { block: 2, exact: "第二段。" },
      ]),
    (error) => anchorCode(error) === "non_contiguous",
    "未覆盖块尾必须拒绝"
  )
  assert.throws(
    () =>
      resolveCrossBlock(blocks, [
        { block: 0, exact: "标题" },
        { block: 2, exact: "第二段。" },
      ]),
    (error) => anchorCode(error) === "non_contiguous",
    "跳块必须拒绝"
  )
})

// ---- Q07：链接协议净化 ----

test("Q07 javascript: 链接被净化（不输出 href），文本保留", () => {
  const blocks = parseBlocks("[click](javascript:alert%281%29)\n")
  assert.equal(blocks[0].text, "click")
  assert.ok(!/href\s*=/.test(blocks[0].html), "危险协议不得渲染 href")
  assert.ok(blocks[0].html.includes("click"))
})

test("Q07 相对图片保留、javascript: 图片被拒；http/https 锚保留", () => {
  const blocks = parseBlocks(
    "![结构图](structure.png)\n\n![坏](javascript:alert(1))\n\n[外链](https://example.com/a)\n"
  )
  const good = blocks.find((block) => block.text === "结构图")
  assert.ok(/src="structure\.png"/.test(good.html))
  const bad = blocks.find((block) => block.text === "坏")
  assert.ok(!/src=/.test(bad.html))
  const external = blocks.find((block) => block.text === "外链")
  assert.ok(/href="https:\/\/example\.com\/a"/.test(external.html))
})

test("Q07 原始 HTML 整体转义（严格策略），投影为源码文本", () => {
  const blocks = parseBlocks('前缀 <img src=x onerror="alert(1)"> 后缀\n')
  assert.ok(!/<img\s/.test(blocks[0].html), "不得存在真实 img 标签")
  assert.ok(blocks[0].html.includes("&lt;img"), "原始 HTML 必须以文本呈现")
  assert.equal(
    blocks[0].text,
    '前缀 <img src=x onerror="alert(1)"> 后缀',
    "投影为源码文本"
  )
})

// ---- Q04/Q08：冻结表示不被重新解析 ----

test("Q04 读取版本返回封存的冻结表示，而非每次重新解析", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-md-"))
  t.after(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(root, { recursive: true, force: true })
        return
      } catch {
        // Windows 句柄释放延迟：有界重试仅用于测试清理
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  })
  const source = join(root, "src")
  await mkdir(source)
  await writeFile(join(source, "doc.md"), "# 标题\n\n第一段。\n")
  const store = new WorkbenchStore(join(root, "v2"))
  await store.open()
  t.after(() => {
    try {
      store.close()
    } catch {
      // 重复关闭容错：清理路径不因已关闭的库失败
    }
  })
  const project = store.createProject("项目", "agentA", "req-p")
  const directory = store.createDirectory(
    project.id,
    null,
    "目录",
    "agentA",
    "req-d"
  )
  const draft = store.createDraft(
    directory.id,
    "markdown",
    "草稿",
    "agentA",
    "req-dr"
  )
  const staged = await store.stagePackage(source, "markdown", "agentA")
  const published = store.publishVersion(
    {
      draftId: draft.id,
      baseSequence: 0,
      artifactId: staged.artifactId,
      requestKey: "req-pub",
    },
    "agentA"
  )
  const artifactPath = store.versionArtifactPath(published.versionId)
  // 封存表示未被解析前的基线
  const baseline = await store.readMarkdownVersion(published.versionId)
  assert.equal(baseline.reading.pipeline, READING_PIPELINE_VERSION)
  // 篡改封存包内的冻结表示：读取必须反映封存内容（证明不重新解析）
  const readingFile = join(artifactPath, ".moon", "reading.json")
  const reading = JSON.parse(await readFile(readingFile, "utf8"))
  reading.blocks[0].text = "TAMPERED"
  await writeFile(readingFile, JSON.stringify(reading))
  const tampered = await store.readMarkdownVersion(published.versionId)
  assert.equal(tampered.reading.blocks[0].text, "TAMPERED")
})

test("Q04 generateReading 走新管线并写入 .moon/reading.json", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-gen-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "doc.md"), "hello **bold** & [x](https://e.com)\n")
  const reading = await generateReading(root)
  assert.equal(reading.entry, "doc.md")
  assert.equal(reading.pipeline, READING_PIPELINE_VERSION)
  assert.equal(reading.blocks[0].text, "hello bold & x")
})

// ---- Q06：差异算法 ----

/** 按 hunks 重建左右原文（UI 消费方式）。 */
const rebuild = (raw, hunks, side) => {
  const lines = raw.split("\n")
  const out = []
  for (const hunk of hunks) {
    const start = side === "left" ? hunk.leftStart : hunk.rightStart
    const count = side === "left" ? hunk.leftCount : hunk.rightCount
    for (let offset = 0; offset < count; offset++)
      out.push(lines[start + offset] ?? "")
  }
  return out.join("\n")
}

test("Q06 hunk 不变量：两侧原文重建逐行一致（审计反例）", () => {
  const store = Object.create(WorkbenchStore.prototype)
  const leftRaw = "a\nb"
  const rightRaw = "a\nx\ny\nb"
  const { hunks } = store.compareMarkdown(leftRaw, rightRaw)
  assert.equal(rebuild(leftRaw, hunks, "left"), leftRaw, "左侧重建不得重复行")
  assert.equal(rebuild(rightRaw, hunks, "right"), rightRaw)
})

test("Q06 hunk 不变量覆盖插入/删除/替换/多段混合", () => {
  const store = Object.create(WorkbenchStore.prototype)
  const cases = [
    ["一行\n二行\n三行", "一行\n二行改\n三行"],
    ["只有删除目标行\n保留", "保留"],
    ["保留", "新增一行\n保留\n再新增"],
    ["a\nb\nc\nd\ne", "a\nc\ne\nf"],
    ["", "全新内容\n第二行"],
    ["旧内容\n第二行", ""],
    ["相同\n相同", "相同\n相同"],
  ]
  for (const [leftRaw, rightRaw] of cases) {
    const { hunks } = store.compareMarkdown(leftRaw, rightRaw)
    assert.equal(
      rebuild(leftRaw, hunks, "left"),
      leftRaw,
      `左侧不一致：${JSON.stringify({ leftRaw, rightRaw })}`
    )
    assert.equal(
      rebuild(rightRaw, hunks, "right"),
      rightRaw,
      `右侧不一致：${JSON.stringify({ leftRaw, rightRaw })}`
    )
  }
})

test("Q06 超过规模守卫明确失败（limit_exceeded），不整段替换降级", () => {
  const store = Object.create(WorkbenchStore.prototype)
  const big = Array.from({ length: 2001 }, (_, index) => `行${index}`).join(
    "\n"
  )
  const big2 = Array.from({ length: 2001 }, (_, index) => `另${index}`).join(
    "\n"
  )
  assert.throws(
    () => store.compareMarkdown(big, big2),
    (error) => workbenchCode(error) === "limit_exceeded"
  )
})

test("Q06 compare_versions 校验两版均属输入 draftId", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-cmp-"))
  t.after(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(root, { recursive: true, force: true })
        return
      } catch {
        // Windows 句柄释放延迟：有界重试仅用于测试清理
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  })
  const store = new WorkbenchStore(join(root, "v2"))
  await store.open()
  t.after(() => {
    try {
      store.close()
    } catch {
      // 重复关闭容错：清理路径不因已关闭的库失败
    }
  })
  const actorContext = { source: "mcp", actorId: "agentA" }
  const v2 = createV2Service(store, {})
  const makeDraftWithVersion = async (requestTag, content) => {
    const project = store.createProject("项目", "agentA", `req-p-${requestTag}`)
    const directory = store.createDirectory(
      project.id,
      null,
      "目录",
      "agentA",
      `req-d-${requestTag}`
    )
    const draft = store.createDraft(
      directory.id,
      "markdown",
      "草稿",
      "agentA",
      `req-dr-${requestTag}`
    )
    const source = join(root, `src-${requestTag}`)
    await mkdir(source)
    await writeFile(join(source, "doc.md"), content)
    const staged = await store.stagePackage(source, "markdown", "agentA")
    const published = store.publishVersion(
      {
        draftId: draft.id,
        baseSequence: 0,
        artifactId: staged.artifactId,
        requestKey: `req-pub-${requestTag}`,
      },
      "agentA"
    )
    return { draftId: draft.id, versionId: published.versionId }
  }
  const left = await makeDraftWithVersion("l", "左内容\n")
  const right = await makeDraftWithVersion("r", "右内容\n")
  await assert.rejects(
    () =>
      v2.operations.v2_compare_versions.execute(
        {
          draftId: left.draftId,
          leftVersionId: left.versionId,
          rightVersionId: right.versionId,
        },
        actorContext
      ),
    (error) => error.code === "validation_failed"
  )
})
