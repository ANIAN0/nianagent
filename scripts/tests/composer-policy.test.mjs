import test from "node:test"
import assert from "node:assert/strict"
import {
  composerDraftEligibility,
  composerDisplayMaterials,
  composerPrimaryAction,
} from "../../src/components/composer/composer-policy.ts"

const data = {
  models: ["text", "vision"],
  modelInputs: { text: ["text"], vision: ["text", "image"] },
}
const draft = { text: "需求", model: "text", materials: [] }

test("one admission policy preserves material-only input and rejects unfinished or incompatible materials", () => {
  assert.equal(
    composerDraftEligibility({ ...draft, text: "  " }, data, true).canSend,
    false
  )
  assert.equal(
    composerDraftEligibility(
      {
        ...draft,
        text: "",
        materials: [{ id: "file", type: "attachment", status: "ready" }],
      },
      data,
      true
    ).canSend,
    true
  )
  assert.equal(
    composerDraftEligibility(
      { ...draft, materials: [{ id: "file", status: "preparing" }] },
      data,
      true
    ).canSend,
    false
  )
  assert.equal(composerDraftEligibility(draft, data, false).canSend, false)
  assert.equal(composerDraftEligibility(draft, data, true, true).canSend, false)
  const imageDraft = {
    ...draft,
    materials: [{ id: "image", type: "image", status: "ready" }],
  }
  assert.equal(composerDraftEligibility(imageDraft, data, true).canSend, false)
  assert.equal(
    composerDraftEligibility({ ...imageDraft, model: "vision" }, data, true)
      .canSend,
    true
  )
  assert.equal(
    imageDraft.materials[0].status,
    "ready",
    "display validation never mutates a prepared source"
  )
  assert.equal(
    composerDisplayMaterials(imageDraft.materials, "text", data.modelInputs)[0]
      .status,
    "failed"
  )
  assert.equal(
    composerDisplayMaterials(
      imageDraft.materials,
      "vision",
      data.modelInputs
    )[0].status,
    "ready"
  )
})

test("ordinary running composer never loses Stop behind blank, invalid, blocked or compact drafts", () => {
  for (const state of [
    { hasDraft: false, canSubmit: false },
    { hasDraft: true, canSubmit: false },
    { hasDraft: true, canSubmit: true, command: true },
  ]) {
    assert.equal(composerPrimaryAction({ ...state, running: true }), "stop")
  }
  assert.equal(
    composerPrimaryAction({ running: true, hasDraft: true, canSubmit: true }),
    "queue"
  )
  assert.equal(
    composerPrimaryAction({ stopping: true, hasDraft: true, canSubmit: true }),
    "stopping"
  )
  assert.equal(
    composerPrimaryAction({ hasDraft: true, canSubmit: true, command: true }),
    "compact"
  )
  assert.equal(
    composerPrimaryAction({ hasDraft: true, canSubmit: true }),
    "send"
  )
})
