import test from "node:test"
import assert from "node:assert/strict"
import { unresolvedComposerQuery } from "../../src/components/composer/composer-draft-query.ts"
import { composerDraftEligibility } from "../../src/components/composer/composer-policy.ts"

test("unselected inline symbols remain ordinary text", () => {
  for (const text of [
    "请解释 Java 的 @Override 注解。",
    "请解释 /usr",
    "检查 @",
    "检查 @missing.md",
    '检查 @"docs/with space.md',
    "联系 user@example.com",
    "解释 /usr/local/bin",
  ]) {
    assert.equal(unresolvedComposerQuery(text, []), undefined)
    assert.equal(
      composerDraftEligibility(
        { text, model: "demo", materials: [] },
        { models: ["demo"] },
        true
      ).canSend,
      true
    )
  }
})

test("leading commands retain explicit command and Skill validation", () => {
  assert.ok(unresolvedComposerQuery("/missing 参数", []))
  assert.ok(unresolvedComposerQuery("/", []))
  assert.equal(unresolvedComposerQuery(" /compact 关注正文", []), undefined)
  assert.ok(unresolvedComposerQuery("/inspect 参数", []))
  assert.equal(
    unresolvedComposerQuery("/inspect 参数", [], "inspect"),
    undefined
  )
  assert.equal(unresolvedComposerQuery("/skill:review 参数", []), undefined)
  assert.ok(unresolvedComposerQuery("/skill:", []))
  assert.equal(
    unresolvedComposerQuery("/skill:review 参数", [
      { type: "skill", name: "review", status: "ready" },
    ]),
    undefined
  )
  assert.equal(
    unresolvedComposerQuery("/skill:review 参数", [
      { type: "skill", name: "review", status: "preparing" },
    ]),
    undefined
  )
  assert.equal(
    unresolvedComposerQuery("/skill:review 参数", [
      { type: "skill", name: "review", status: "failed" },
    ]),
    undefined
  )
})

test("selected materials still require readiness and a compatible model", () => {
  for (const status of ["preparing", "failed"]) {
    const eligibility = composerDraftEligibility(
      {
        text: "请解释 @Override",
        model: "demo",
        materials: [{ id: "picked", name: "picked", type: "file", status }],
      },
      { models: ["demo"] },
      true
    )
    assert.equal(eligibility.canSend, false)
    assert.equal(eligibility.reasonKind, "materials")
  }
  const eligibility = composerDraftEligibility(
    {
      text: "请解释 /usr",
      model: "demo",
      materials: [{ id: "image", name: "image", type: "image", status: "ready" }],
    },
    { models: ["demo"], modelInputs: { demo: ["text"] } },
    true
  )
  assert.equal(eligibility.canSend, false)
  assert.equal(eligibility.reasonKind, "image")
})
