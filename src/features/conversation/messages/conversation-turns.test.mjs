import test from "node:test"
import assert from "node:assert/strict"
import {
  projectConversationTurns,
  messageBlocks,
} from "../conversation-turns.ts"

test("ten Pi steps share one user turn and the real final fork boundary", () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({
    id: `step-${index}`,
    role: "assistant",
    userTurnId: "user",
    historyIndex: index * 2 + 2,
    entryId: `pi-step-${index}`,
    stopReason: "toolUse",
    status: "settled",
    text: `process ${index}`,
  }))
  const final = {
    id: "answer",
    role: "assistant",
    userTurnId: "user",
    historyIndex: 22,
    entryId: "pi-final",
    stopReason: "stop",
    status: "settled",
    text: "final answer",
  }
  const turns = projectConversationTurns([
    {
      id: "user",
      role: "user",
      userTurnId: "user",
      historyIndex: 1,
      status: "settled",
      text: "request",
    },
    ...steps,
    final,
  ])
  assert.equal(turns.length, 1)
  assert.equal(turns[0].messages.length, 11)
  assert.equal(turns[0].tail.entryId, "pi-final")
  assert.equal(turns[0].response, "final answer")
})

test("authoritative pending historyIndex stays after earlier tool steps", () => {
  const turns = projectConversationTurns([
    {
      id: "pending",
      role: "assistant",
      userTurnId: "user",
      historyIndex: 40,
      status: "streaming",
      text: "current",
    },
    {
      id: "user",
      role: "user",
      userTurnId: "user",
      historyIndex: 6,
      status: "settled",
      text: "request",
    },
    {
      id: "step",
      role: "assistant",
      userTurnId: "user",
      historyIndex: 8,
      status: "settled",
      stopReason: "toolUse",
      text: "stage",
    },
  ])
  assert.deepEqual(
    turns[0].messages.map((message) => message.id),
    ["step", "pending"],
  )
})

test("a continuation is its own input and does not turn an interrupted attempt into success", () => {
  const turns = projectConversationTurns([
    {
      id: "first",
      role: "user",
      userTurnId: "first",
      status: "settled",
      text: "request",
    },
    {
      id: "stopped",
      role: "assistant",
      userTurnId: "first",
      status: "interrupted",
      stopReason: "aborted",
      text: "partial",
    },
    {
      id: "next",
      role: "user",
      userTurnId: "next",
      inputKind: "continuation",
      continuationOf: "first",
      status: "settled",
      text: "continue",
    },
    {
      id: "resumed",
      role: "assistant",
      userTurnId: "next",
      status: "settled",
      stopReason: "stop",
      text: "completed",
    },
  ])
  assert.equal(turns.length, 2)
  assert.equal(turns[0].continued, true)
  assert.equal(turns[0].tail.status, "interrupted")
  assert.equal(turns[1].tail.status, "settled")
})

test("ordered blocks are authoritative and do not prepend aggregate thinking", () => {
  const blocks = [
    { id: "text", type: "text", text: "intro" },
    { id: "thinking", type: "thinking", text: "reason", phase: "settled" },
  ]
  assert.equal(
    messageBlocks({
      id: "step",
      role: "assistant",
      status: "streaming",
      text: "intro",
      thinking: { text: "duplicated" },
      blocks,
    }),
    blocks,
  )
})

const attemptIssue = {
  code: "model_unavailable",
  summary: "服务暂时不可用。",
  recovery: "retry",
  severity: "error",
}
const attemptUser = (id, index) => ({
  id,
  role: "user",
  userTurnId: id,
  runId: "run",
  historyIndex: index,
  status: "settled",
  text: "检查项目",
})
const attemptReply = (
  id,
  userTurnId,
  index,
  status,
  stopReason,
  extra = {},
) => ({
  id,
  role: "assistant",
  userTurnId,
  runId: "run",
  historyIndex: index,
  status,
  stopReason,
  text: status === "failed" ? "" : "已完成回复。",
  ...extra,
})

test("same authoritative input and run mark an earlier failed attempt recovered without changing history", () => {
  const failed = attemptReply("first-failed", "user", 2, "failed", "error", {
    issue: attemptIssue,
  })
  const turns = projectConversationTurns([
    attemptUser("user", 1),
    failed,
    attemptReply("success", "user", 3, "settled", "stop"),
  ])
  assert.deepEqual([...turns[0].recoveredAttemptIds], ["first-failed"])
  assert.equal(turns[0].messages[0], failed)
  assert.equal(failed.status, "failed")
  assert.equal(failed.issue, attemptIssue)
  assert.equal(turns[0].continued, false)
})

test("exhausted retries, length stops, tool steps and missing or different run identities cannot imply recovery", () => {
  for (const ending of [
    attemptReply("exhausted", "user", 3, "failed", "error", {
      issue: attemptIssue,
    }),
    attemptReply("limited", "user", 3, "settled", "length"),
    attemptReply("tool-step", "user", 3, "settled", "toolUse"),
    attemptReply("other-run", "user", 3, "settled", "stop", {
      runId: "another-run",
    }),
    attemptReply("legacy", "user", 3, "settled", "stop", { runId: undefined }),
  ]) {
    const turns = projectConversationTurns([
      attemptUser("user", 1),
      attemptReply("first-failed", "user", 2, "failed", "error", {
        issue: attemptIssue,
      }),
      ending,
    ])
    assert.equal(turns[0].recoveredAttemptIds.size, 0)
  }
})

test("a later input's success does not recover the earlier attempt; explicit continuation remains independent", () => {
  for (const continuation of [false, true]) {
    const turns = projectConversationTurns([
      attemptUser("first", 1),
      attemptReply("first-failed", "first", 2, "failed", "error", {
        issue: attemptIssue,
      }),
      {
        ...attemptUser("next", 3),
        ...(continuation
          ? { inputKind: "continuation", continuationOf: "first" }
          : {}),
      },
      attemptReply("success", "next", 4, "settled", "stop"),
    ])
    assert.equal(turns[0].recoveredAttemptIds.size, 0)
    assert.equal(turns[0].continued, continuation)
    assert.equal(turns[0].tail.status, "failed")
  }
})
