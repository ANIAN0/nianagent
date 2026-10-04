import test from "node:test"
import assert from "node:assert/strict"
import { thinkingSummary } from "./thinking-summary.ts"

test("the first partial streaming line keeps a stable placeholder across tokens", () => {
  for (const text of [
    "",
    "The",
    "The request",
    "The request requires analysis.",
  ])
    assert.equal(thinkingSummary(text, true), "正在分析…")
})

test("a complete line remains the summary while a later line streams", () => {
  const completed = "## **先核对工具与输入边界。**\n"
  for (const next of ["", "然", "然后查看", "然后查看实际调用状态"])
    assert.equal(
      thinkingSummary(completed + next, true),
      "先核对工具与输入边界。",
    )
  assert.equal(
    thinkingSummary(completed + "\n下一段尚未结束", true),
    "先核对工具与输入边界。",
  )
  assert.equal(
    thinkingSummary(completed + "第二步已核对。\n正在", true),
    "第二步已核对。",
  )
})

test("settled phase uses the final readable line without requiring a newline", () => {
  const text = "先核对输入。\n**最终确认真实工具顺序。**"
  assert.equal(thinkingSummary(text, true), "先核对输入。")
  assert.equal(thinkingSummary(text, false), "最终确认真实工具顺序。")
})

test("CRLF and empty Markdown-only completed lines do not expose partial text", () => {
  assert.equal(
    thinkingSummary("> **已完成文件核对。**\r\n\r\n```ts\r\n下一行", true),
    "已完成文件核对。",
  )
  assert.equal(thinkingSummary("**\n正在输出", true), "正在分析…")
  assert.equal(
    thinkingSummary("- [核对路径](./result.md)\n继续", true),
    "核对路径",
  )
})
