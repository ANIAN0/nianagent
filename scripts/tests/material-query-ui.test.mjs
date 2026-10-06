import test from "node:test"
import assert from "node:assert/strict"
import {
  materialQueryAtSelection,
  materialCandidateMatches,
  replaceMaterialQuery,
} from "../../src/features/home/material-query.ts"
import { materialPanelPlacement } from "../../src/features/home/material-panel-position.ts"
import { nextComposerPanel } from "../../src/features/home/composer-panel-state.ts"
import { removeComposerMaterial } from "../../src/features/materials/composer-material-edit.ts"

test("shortened candidate labels keep full relative path and Windows directory search", () => {
  const identity = "guide.md C:\\工作区\\moon\\docs\\guide.md docs\\guide.md"
  assert.equal(materialCandidateMatches(identity, "docs/"), true)
  assert.equal(materialCandidateMatches(identity, "DOCS\\guide"), true)
  assert.equal(materialCandidateMatches(identity, "other/"), false)
})

test("moving out of and back into a file query uses the current complete range", () => {
  const text = "检查 @README.md 后继续阅读"
  assert.equal(materialQueryAtSelection(text, 0), null)
  assert.equal(materialQueryAtSelection(text, 2), null)
  assert.equal(materialQueryAtSelection(text, 7, 10), null)
  const current = materialQueryAtSelection(text, 7)
  assert.equal(current.mode, "file")
  assert.equal(current.query, "REA")
  assert.equal(text.slice(current.start, current.end), "@README.md")
  assert.deepEqual(replaceMaterialQuery(text, current, ""), {
    text: "检查  后继续阅读",
    caret: 3,
  })
})

test("a quoted Chinese path retains surrounding multiline text when picked", () => {
  const text = '第一行\n请读取 @"文档/设计 说明.md" 并总结'
  const caret = text.indexOf(" 说明")
  const current = materialQueryAtSelection(text, caret)
  assert.equal(current.query, "文档/设计")
  assert.equal(text.slice(current.start, current.end), '@"文档/设计 说明.md"')
  assert.equal(
    replaceMaterialQuery(text, current, "").text,
    "第一行\n请读取  并总结"
  )
  assert.equal(materialQueryAtSelection(text, text.length), null)
})

test("slash and Skill candidates replace one call instead of leaving token suffixes", () => {
  const text = "/skill:代码审查 检查当前修改"
  const current = materialQueryAtSelection(text, 9)
  assert.equal(current.mode, "skill")
  assert.equal(current.query, "代码")
  assert.equal(
    replaceMaterialQuery(text, current, "/skill:文档整理 ").text,
    "/skill:文档整理  检查当前修改"
  )
  assert.equal(materialQueryAtSelection(text, text.length), null)
  assert.equal(materialQueryAtSelection("/compact 保留接口", 3).mode, "slash")
})

test("removing selected file and quoted references preserves whitespace, prose and ordinary Skill text", () => {
  const cwd = "H:/工作区/moon"
  const file = {
    id: "file-a",
    name: "README.md",
    kind: "附件",
    type: "file",
    source: `${cwd}/README.md`,
    presentation: "reference",
  }
  const quoted = {
    id: "quoted",
    name: "设计 说明.md",
    kind: "附件",
    type: "file",
    source: `${cwd}/文档/设计 说明.md`,
    presentation: "reference",
  }
  const folder = {
    id: "folder",
    name: "文档 目录",
    kind: "附件",
    type: "directory",
    source: `${cwd}/文档 目录`,
    presentation: "reference",
  }
  const other = {
    id: "other",
    name: "验收.md",
    kind: "附件",
    type: "file",
    source: `${cwd}/验收.md`,
  }
  for (const [material, text, expected] of [
    [
      file,
      "/skill:代码审查 请读 @README.md 并检查 @README.md.backup",
      "/skill:代码审查 请读  并检查 @README.md.backup",
    ],
    [
      file,
      "@README.md.backup @README.md \n@README.md 正文",
      "@README.md.backup  \n 正文",
    ],
    [file, "\t\u00a0@README.md\t正文", "\t\u00a0\t正文"],
    [
      quoted,
      '第一行\n请读 @"文档/设计 说明.md" 并继续 /skill:文档整理',
      "第一行\n请读  并继续 /skill:文档整理",
    ],
    [folder, '检查 @"文档 目录" 后继续', "检查  后继续"],
  ]) {
    const original = {
      text,
      materials: [material, other],
      model: "saved-model",
    }
    const draft = Object.freeze({
      ...original,
      materials: Object.freeze([Object.freeze(material), Object.freeze(other)]),
    })
    const next = removeComposerMaterial(draft, material.id, cwd)
    assert.equal(next.text, expected)
    assert.deepEqual(next.materials, [other])
    assert.equal(next.model, "saved-model")
    assert.deepEqual(draft, original)
  }
})

test("missing identities and similar paths never remove prose or another selected material", () => {
  const cwd = "H:/工作区/moon"
  const file = {
    id: "file-a",
    name: "README.md",
    kind: "附件",
    type: "file",
    source: `${cwd}/README.md`,
    presentation: "reference",
  }
  const other = {
    ...file,
    id: "other",
    name: "验收.md",
    source: `${cwd}/验收.md`,
  }
  const draft = {
    text: '请读 @README.md.backup @README.md /skill:代码审查 @"README.md".backup',
    materials: [file, other],
  }
  const original = structuredClone(draft)
  assert.deepEqual(removeComposerMaterial(draft, "missing", cwd), draft)
  const next = removeComposerMaterial(draft, other.id, cwd)
  assert.equal(next.text, draft.text)
  assert.deepEqual(next.materials, [file])
  const similar = {
    text: "普通x@README.md @README.md.backup /skill:代码审查",
    materials: [file],
  }
  assert.equal(removeComposerMaterial(similar, file.id, cwd).text, similar.text)
  assert.deepEqual(draft, original)
})

function withinViewport(placement, viewportHeight, expectedWidth) {
  assert.equal(placement.width, expectedWidth)
  assert.ok(placement.left >= 12)
  const top =
    placement.top ?? viewportHeight - placement.bottom - placement.maxHeight
  assert.ok(top >= 12)
  assert.ok(top + placement.maxHeight <= viewportHeight - 12)
  assert.ok(placement.maxHeight > 0)
}

test("a card scrolled above the short viewport places materials near its visible trigger", () => {
  const placement = materialPanelPlacement({
    card: { top: -220, bottom: 520, left: 16, width: 358 },
    trigger: { top: 468, bottom: 496, left: 30, width: 28 },
    mode: "button",
    viewportWidth: 390,
    viewportHeight: 620,
    desiredHeight: 382,
  })
  assert.equal(placement.side, "top")
  assert.equal(placement.bottom, 156)
  withinViewport(placement, 620, 358)
})

test("a near-top trigger falls below while a normal card keeps its confirmed upper anchor", () => {
  const bottom = materialPanelPlacement({
    card: { top: -300, bottom: 96, left: -20, width: 500 },
    trigger: { top: 48, bottom: 76, left: 30, width: 28 },
    mode: "button",
    viewportWidth: 390,
    viewportHeight: 620,
    desiredHeight: 382,
  })
  assert.equal(bottom.side, "bottom")
  assert.equal(bottom.top, 80)
  withinViewport(bottom, 620, 366)
  const normal = materialPanelPlacement({
    card: { top: 350, bottom: 490, left: 200, width: 880 },
    trigger: { top: 450, bottom: 478, left: 214, width: 28 },
    mode: "button",
    viewportWidth: 1280,
    viewportHeight: 720,
    desiredHeight: 160,
  })
  assert.equal(normal.bottom, 374)
  withinViewport(normal, 720, 880)
})

test("typed candidates use the visible text area when the card top is unavailable", () => {
  const placement = materialPanelPlacement({
    card: { top: -300, bottom: 496, left: 16, width: 358 },
    trigger: { top: 450, bottom: 478, left: 30, width: 28 },
    text: { top: 44, bottom: 432, left: 28, width: 334 },
    mode: "file",
    viewportWidth: 390,
    viewportHeight: 620,
    desiredHeight: 382,
  })
  assert.equal(placement.side, "bottom")
  assert.equal(placement.top, 72)
  withinViewport(placement, 620, 358)
})

test("late closes and unmounts cannot release a newly opened composer panel", () => {
  let active = nextComposerPanel(null, "materials", true)
  active = nextComposerPanel(active, "model", true)
  active = nextComposerPanel(active, "materials", false)
  assert.equal(active, "model")
  active = nextComposerPanel(active, "session", true)
  active = nextComposerPanel(active, "model", false)
  assert.equal(active, "session")
  assert.equal(nextComposerPanel(active, "session", false), null)
})
