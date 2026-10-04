import test from "node:test"
import assert from "node:assert/strict"
import { localMessagePath, isExternalMessageLink } from "./message-path.ts"

test("local references preserve file identity and separate URI fragments", () => {
  assert.equal(localMessagePath("generated.md#L12"), "generated.md")
  assert.equal(localMessagePath("docs/result.md#summary"), "docs/result.md")
  assert.equal(
    localMessagePath("H:/workspace/moon/result%20one.md#L2"),
    "H:/workspace/moon/result one.md"
  )
  assert.equal(
    localMessagePath("file:///H:/workspace/moon/result.md"),
    "H:/workspace/moon/result.md"
  )
  assert.equal(localMessagePath("docs/part%23one.md"), "docs/part#one.md")
  // The host's workspace scope owns realpath checks, including traversal.
  assert.equal(localMessagePath("../other.md"), "../other.md")
})

test("external links and untrusted schemes are not local files or image sources", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "https://example.com/a.md",
    "//example.com/a.md",
    "a%0Ab.md",
    "%invalid",
    "#section"
  ])
    assert.equal(localMessagePath(value), undefined)
  assert.equal(isExternalMessageLink("https://example.com/docs"), true)
  assert.equal(isExternalMessageLink("mailto:user@example.com"), true)
  assert.equal(isExternalMessageLink("generated.md"), false)
})
