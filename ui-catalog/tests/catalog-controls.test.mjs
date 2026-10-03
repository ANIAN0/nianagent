import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCatalogHref,
  parseViewportDimension,
  readViewportDimension,
} from "../catalog-controls.ts"

test("compact formal component heights remain valid in URL restoration and input commits", () => {
  for (const height of [100, 180, 200]) {
    assert.equal(parseViewportDimension(String(height), "height"), height)
    assert.equal(readViewportDimension(String(height), "height", 600), height)
    assert.equal(readViewportDimension(null, "height", height), height)
  }
})

test("width and height use their own inclusive bounds and reject invalid drafts without coercion", () => {
  for (const [axis, minimum, maximum] of [
    ["width", 240, 2560],
    ["height", 96, 1600],
  ]) {
    assert.equal(parseViewportDimension(String(minimum), axis), minimum)
    assert.equal(parseViewportDimension(String(maximum), axis), maximum)
    for (const invalid of [
      null,
      "",
      " ",
      String(minimum - 1),
      String(maximum + 1),
      "390.5",
      "Infinity",
      "NaN",
      "1e3",
      "0x180",
      "-390",
      "390px",
    ]) {
      assert.equal(
        parseViewportDimension(invalid, axis),
        null,
        `${axis}: ${invalid}`
      )
      assert.equal(readViewportDimension(invalid, axis, minimum), minimum)
    }
  }
  assert.equal(parseViewportDimension(" 0390 ", "width"), 390)
})

const tooltip = {
  id: "tooltip",
  states: [{ id: "default" }, { id: "focused" }],
  viewport: { width: 420, height: 200 },
}
const current = {
  component: "tooltip",
  stateId: "missing",
  width: 390,
  height: 200,
  theme: "dark",
}

test("unknown state recovery yields a usable overview state and retains theme and exact viewport", () => {
  const params = new URLSearchParams(buildCatalogHref(tooltip, current))
  assert.equal(params.get("component"), "tooltip")
  assert.equal(params.get("view"), "docs")
  assert.equal(params.get("state"), "default")
  assert.equal(params.get("theme"), "dark")
  assert.equal(params.get("width"), "390")
  assert.equal(params.get("height"), "200")
  assert.ok(tooltip.states.some((state) => state.id === params.get("state")))
})

test("valid state is retained for same-component docs, explicit canvas uses a valid state, and cross-component docs reset to its default", () => {
  assert.equal(
    new URLSearchParams(
      buildCatalogHref(tooltip, { ...current, stateId: "focused" })
    ).get("state"),
    "focused"
  )
  const canvas = new URLSearchParams(
    buildCatalogHref(tooltip, current, "missing")
  )
  assert.equal(canvas.get("view"), "canvas")
  assert.equal(canvas.get("state"), "default")
  const different = {
    ...tooltip,
    id: "other",
    viewport: { width: 640, height: 100 },
  }
  const next = new URLSearchParams(
    buildCatalogHref(different, { ...current, stateId: "focused" })
  )
  assert.equal(next.get("state"), "default")
  assert.equal(next.get("width"), "640")
  assert.equal(next.get("height"), "100")
  assert.equal(next.get("theme"), "dark")
})
