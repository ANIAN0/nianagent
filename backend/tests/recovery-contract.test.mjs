import test from "node:test"
import assert from "node:assert/strict"
import { operations, transportRecoveryByOperation } from "../contract.mjs"
import { writeOperations } from "../write-receipt-contract.mjs"

test("every operation declares response-loss recovery and receipt support comes from its authoritative contract", () => {
  assert.deepEqual(Object.keys(transportRecoveryByOperation).sort(), Object.keys(operations).sort())
  for (const [name, definition] of Object.entries(operations)) {
    assert.equal(definition.transportRecovery, transportRecoveryByOperation[name])
    assert.equal(Boolean(definition.writeReceipt), writeOperations.includes(name))
    if (definition.writeReceipt) {
      assert.ok(definition.request.properties.operationRequestId)
      assert.ok(definition.args.includes("operationRequestId"))
    }
  }
  assert.equal(transportRecoveryByOperation.check, "none")
  assert.equal(transportRecoveryByOperation.discover, "reload")
  assert.equal(transportRecoveryByOperation.mcpTest, "reload")
  assert.equal(transportRecoveryByOperation.conversationSend, "check")
  assert.deepEqual(operations.writeReceiptRead.request.properties.operation.enum, writeOperations)
})
