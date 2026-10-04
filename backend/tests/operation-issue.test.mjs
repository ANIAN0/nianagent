import test from "node:test"
import assert from "node:assert/strict"
import {
  modelFailureIssue,
  operationError,
  publicFailure,
} from "../operation-issue.mjs"
import { assertSchema, schemas } from "../schema.mjs"
import { QueueDispatchPersistenceError } from "../conversation-queue.mjs"

test("cancellation after an uncertain commit cannot erase its check recovery", () => {
  const error = operationError(
    "result_unknown",
    "配置已提交，但收尾未能确认，请先核对。",
    "check"
  )
  const failure = publicFailure(error, "mcpSave", true)
  assert.equal(failure.issue.code, "result_unknown")
  assert.equal(failure.issue.recovery, "check")
  assert.equal(failure.issue.severity, "warning")
})

test("provider failures retain recovery categories without exposing response bodies", () => {
  const cases = [
    ["401 unauthorized", "model_authentication", "settings"],
    ["400 invalid request", "model_request_invalid", "settings"],
    ["429 rate limit", "model_busy", "retry"],
    ["503 overloaded", "model_unavailable", "retry"],
    ["context length exceeded", "context_limit", "settings"],
  ]
  for (const [reason, code, recovery] of cases) {
    const issue = modelFailureIssue(
      new Error(`${reason} SECRET_FIXTURE_TOKEN https://private.example/path`)
    )
    assertSchema(schemas.OperationIssue, issue)
    assert.equal(issue.code, code)
    assert.equal(issue.recovery, recovery)
    assert.doesNotMatch(
      JSON.stringify(issue),
      /SECRET_FIXTURE_TOKEN|private\.example/
    )
  }
})

test("queue storage failures retain safe diagnostics and are not misclassified as model errors", () => {
  const cause = Object.assign(new Error("EPERM rename SECRET_FIXTURE_PATH"), {
    code: "EPERM",
    syscall: "rename",
  })
  const error = new QueueDispatchPersistenceError("queue", cause)
  const failure = publicFailure(error, "conversationQueueDeliver")
  assertSchema(schemas.RpcFailure, failure)
  assert.equal(failure.issue.code, "queue_storage")
  assert.equal(failure.error, failure.issue.summary)
  assert.match(failure.issue.details, /EPERM/)
  assert.match(failure.issue.details, /rename/)
  assert.doesNotMatch(JSON.stringify(failure), /SECRET_FIXTURE_PATH/)
})

test("cancellation is informational, and unsafe general errors never become public reasons", () => {
  const cancelled = publicFailure(
    Object.assign(new Error("private cancel body"), { name: "AbortError" }),
    "mcpTest"
  )
  assert.equal(cancelled.issue.code, "cancelled")
  assert.equal(cancelled.issue.severity, "info")
  assert.equal(cancelled.issue.recovery, "none")
  const failure = publicFailure(
    new Error("读取失败 H:/private/SECRET_FIXTURE_PATH"),
    "conversationRead"
  )
  assertSchema(schemas.RpcFailure, failure)
  assert.equal(failure.issue.recovery, "reload")
  assert.doesNotMatch(JSON.stringify(failure), /SECRET_FIXTURE_PATH/)
})
