import test from "node:test"
import assert from "node:assert/strict"
import { parseCanvas, diffCanvas, boardTargets } from "../../../apps/workbench/src/server/notes/readers/board.mjs"

const node = (id, x = 10) => ({
  id,
  type: "text",
  x,
  y: 10,
  width: 100,
  height: 60,
  text: id,
})
const base = () => ({
  nodes: [
    {
      id: "g",
      type: "group",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      label: "分组",
    },
    node("a"),
    node("b", 200),
    node("remove", 350),
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b", label: "连接" }],
})

test("标准连线与分组标签规范化，目标上下文完整", () => {
  const canvas = parseCanvas(JSON.stringify(base()))
  assert.deepEqual(canvas.edges[0], {
    id: "e",
    from: "a",
    to: "b",
    label: "连接",
  })
  const targets = boardTargets(canvas)
  assert.deepEqual(targets.find((t) => t.objectId === "a").context, {
    group: "g",
    groupText: "分组",
  })
  assert.deepEqual(targets.find((t) => t.objectId === "e").context, {
    from: "a",
    to: "b",
  })
})

test("对象diff五类完整，同ID移动不算新增", () => {
  const a = base(),
    b = base()
  b.nodes[1].text = "修改"
  b.nodes[1].x = 30
  b.nodes = b.nodes.filter((n) => n.id !== "remove")
  b.nodes.push(node("new", 350))
  b.edges[0].toNode = "new"
  const diff = diffCanvas(
    parseCanvas(JSON.stringify(a)),
    parseCanvas(JSON.stringify(b))
  )
  assert.deepEqual(
    diff.added.map((x) => x.id),
    ["new"]
  )
  assert.deepEqual(
    diff.removed.map((x) => x.id),
    ["remove"]
  )
  assert.deepEqual(
    diff.contentChanged.map((x) => x.id),
    ["a"]
  )
  assert.deepEqual(
    diff.layoutChanged.map((x) => x.id),
    ["a"]
  )
  assert.deepEqual(
    diff.connectionChanged.map((x) => x.id),
    ["e"]
  )
})

test("不支持类型、悬空连接、重复对象身份必须拒绝", () => {
  for (const mutate of [
    (c) => {
      c.nodes[1].type = "file"
    },
    (c) => {
      c.edges[0].toNode = "absent"
    },
    (c) => {
      c.edges.push({ ...c.edges[0] })
    },
    (c) => {
      c.nodes.push({ ...c.nodes[1] })
    },
    (c) => {
      c.edges[0].id = "a"
    },
  ]) {
    const canvas = base()
    mutate(canvas)
    assert.throws(() => parseCanvas(JSON.stringify(canvas)), {
      code: "unsupported_artifact",
    })
  }
})
