import test from "node:test"
import assert from "node:assert/strict"
import {
  parseManifest,
  validPreviewRoute,
} from "../../../apps/workbench/src/server/notes/readers/ui.mjs"
import { classifyPreviewPath } from "../../../apps/workbench/src/server/notes/preview-path.mjs"

test("预览路由必须与浏览器路径一致且不能切换来源或携带查询片段", () => {
  for (const route of [
    "/",
    "/details",
    "/api-guide",
    "/_next-guide",
    "/nested/api",
    "/nested/page",
    "/%E8%AF%A6%E6%83%85",
    "/with%20space",
  ])
    assert.equal(validPreviewRoute(route), true, route)
  for (const route of [
    "//outside.test/",
    "/api",
    "/api/help",
    "/%61pi/help",
    "/_next",
    "/_next/static",
    "/%5Fnext/static",
    "/__moon-bridge.js",
    "/%5F_moon-bridge.js",
    "/a?x=1",
    "/a#target",
    "/a/../b",
    "/%2e%2e/b",
    "/a%2fb",
    "/a%5cb",
    "/%00",
    "/%0A",
    "/详情",
    "/bad%",
    "/a\\b",
  ])
    assert.throws(
      () =>
        parseManifest(
          JSON.stringify({
            routes: { "/": "index.html", [route]: "index.html" },
          }),
          ["index.html"]
        ),
      (error) => error.code === "unsupported_artifact",
      route
    )
  assert.equal(classifyPreviewPath("/__moon-bridge.js"), "bridge")
  for (const file of [
    "/index.html",
    "../index.html",
    "a\\b.html",
    "index.html?x",
    "index.html#x",
  ])
    assert.throws(
      () => parseManifest(JSON.stringify({ routes: { "/": file } }), [file]),
      (error) => error.code === "unsupported_artifact",
      file
    )
  assert.deepEqual(
    parseManifest(
      '{"routes":{"/":"index.html","/details":"nested/details.html"}}',
      ["index.html", "nested/details.html"]
    ),
    { routes: { "/": "index.html", "/details": "nested/details.html" } }
  )
})
