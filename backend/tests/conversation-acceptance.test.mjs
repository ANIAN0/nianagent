import test from "node:test"
import assert from "node:assert/strict"
import { acceptedRequestIds } from "../conversations.mjs"

const request = (id) => ({ type: "custom", customType: "moon-request", data: { clientRequestId: id } })
const message = (role) => ({ type: "message", message: { role } })
const custom = (customType) => ({ type: "custom_message", customType })
const accepted = (entries) => [...acceptedRequestIds({ getEntries: () => entries })]

test("cold acceptance consumes a request only for its persisted user input or explicit continuation", () => {
  assert.deepEqual(accepted([request("not-accepted"), custom("extension-display"), message("assistant"), message("toolResult")]), [])
  assert.deepEqual(accepted([request("user"), custom("extension-display"), message("user"), custom("moon-continuation"), request("pending")]), ["user"])
  assert.deepEqual(accepted([request("continue"), custom("moon-continuation"), request("pending"), custom("extension-summary")]), ["continue"])
  assert.deepEqual(accepted([request("orphan"), request("actual"), message("user")]), ["actual"])
  assert.deepEqual(accepted([message("user"), request("pending")]), [])
})
