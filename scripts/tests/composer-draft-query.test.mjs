import test from "node:test"
import assert from "node:assert/strict"
import { unresolvedComposerQuery } from "../../src/components/composer/composer-draft-query.ts"
test("unresolved resource and command claims cannot become ordinary model text", () => {
  const file = {
    type: "file",
    status: "ready",
    source: "H:/moon/docs/with space.md",
  }
  assert.ok(unresolvedComposerQuery("检查 @", []))
  assert.ok(unresolvedComposerQuery("检查 @missing.md", [file]))
  assert.equal(
    unresolvedComposerQuery('检查 @"docs/with space.md"', [file]),
    undefined
  )
  assert.ok(unresolvedComposerQuery('检查 @"docs/with space.md', [file]))
  assert.ok(unresolvedComposerQuery("/missing 参数", []))
  assert.ok(unresolvedComposerQuery("/", []))
  assert.equal(unresolvedComposerQuery("联系 user@example.com", []), undefined)
  assert.equal(
    unresolvedComposerQuery("/skill:review 参数", [
      { type: "skill", name: "review", status: "ready" },
    ]),
    undefined
  )
  assert.ok(
    unresolvedComposerQuery("/skill:review 参数", [
      { type: "skill", name: "review", status: "preparing" },
    ])
  )
})
