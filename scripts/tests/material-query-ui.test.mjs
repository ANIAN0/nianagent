import test from "node:test"
import assert from "node:assert/strict"
import {
  materialQueryAtSelection,
  replaceMaterialQuery,
} from "../../src/features/home/material-query.ts"
import { materialPanelPlacement } from "../../src/features/home/material-panel-position.ts"
import { nextComposerPanel } from "../../src/features/home/composer-panel-state.ts"
import { removeComposerMaterial } from "../../src/features/materials/composer-material-edit.ts"

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

test("removing a bound Skill releases the trimmed invocation and retains leading whitespace and body", () => {
  const skill = {
    id: "skill-a",
    name: "代码审查",
    kind: "Skill",
    type: "skill",
  }
  const file = { id: "file-a", name: "验收.md", kind: "文件引用", type: "file" }
  for (const [text, expected] of [
    ["/skill:代码审查 正文", "正文"],
    ["  /skill:代码审查 正文", "  正文"],
    ["\n/skill:代码审查\n正文", "\n\n正文"],
    ["\t\u00a0/skill:代码审查\t正文", "\t\u00a0正文"],
    [" \ufeff/skill:代码审查", " \ufeff"],
  ]) {
    const draft = { text, materials: [skill, file], model: "saved-model" }
    const next = removeComposerMaterial(draft, "skill-a")
    assert.equal(next.text, expected)
    assert.deepEqual(next.materials, [file])
    assert.equal(next.model, "saved-model")
    assert.equal(draft.text, text)
    assert.deepEqual(draft.materials, [skill, file])
  }
})

test("removing a material cannot release another or embedded Skill invocation", () => {
  const skill = {
    id: "skill-a",
    name: "代码审查",
    kind: "Skill",
    type: "skill",
  }
  for (const text of [
    "  /skill:文档整理 正文",
    "  /skill:代码审查扩展 正文",
    "请说明 /skill:代码审查 的用途",
  ])
    assert.equal(
      removeComposerMaterial({ text, materials: [skill] }, "skill-a").text,
      text
    )
  const text = "  /skill:代码审查 正文"
  assert.equal(
    removeComposerMaterial(
      {
        text,
        materials: [{ ...skill, type: "file" }],
      },
      "skill-a"
    ).text,
    text
  )
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
