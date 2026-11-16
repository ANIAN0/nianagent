import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { runInNewContext } from "node:vm"
import { transform } from "sucrase"

async function loadSidebar(storage) {
  const source = await readFile(
    new URL("../src/features/plugins/plugin-sidebar-state.ts", import.meta.url),
    "utf8"
  )
  const exports = {}
  runInNewContext(
    transform(source, { transforms: ["typescript", "imports"] }).code,
    {
      exports,
      require: (name) => {
        assert.equal(name, "@/lib/rpc/profile-storage")
        return { profileLocalStorage: storage }
      },
    }
  )
  return exports
}

test("插件面板损坏记录不得变空并被覆盖，读权限失败必须明确拒绝", async () => {
  const records = new Map([["moon.plugin-sidebar.v1.bad", "{bad"]])
  const sidebar = await loadSidebar({
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  })
  assert.throws(() => sidebar.readSidebarLayout("bad"), /无法读取/)
  assert.equal(records.get("moon.plugin-sidebar.v1.bad"), "{bad")
  assert.equal(sidebar.readSidebarLayout("new").tabs.length, 0)
  const denied = await loadSidebar({
    getItem() {
      throw new Error("permission denied")
    },
  })
  assert.throws(() => denied.readSidebarLayout("private"), /无法读取/)
})

test("插件面板写失败不得更新已保存缓存，恢复后保存与重读一致", async () => {
  const records = new Map()
  let denied = false
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem(key, value) {
      if (denied) throw new Error("quota exceeded")
      records.set(key, value)
    },
  }
  const sidebar = await loadSidebar(storage)
  const before = sidebar.emptySidebarLayout()
  sidebar.saveSidebarLayout("s", before)
  denied = true
  assert.throws(
    () => sidebar.saveSidebarLayout("s", { ...before, width: 500 }),
    /未保存/
  )
  assert.equal(sidebar.readSidebarLayout("s").width, 420)
  denied = false
  sidebar.saveSidebarLayout("s", { ...before, width: 500 })
  assert.equal((await loadSidebar(storage)).readSidebarLayout("s").width, 500)
})

test("用户可见错误编号来自规范反馈，非法标识不进入文案", async () => {
  const source = await readFile(
    new URL("../src/lib/operation-issue.ts", import.meta.url),
    "utf8"
  )
  const exports = {}
  runInNewContext(
    transform(source, { transforms: ["typescript", "imports"] }).code,
    { exports }
  )
  const issue = {
    code: "port_in_use",
    summary: "端口已占用。",
    recovery: "settings",
    severity: "error",
    errorId: "750d8456",
  }
  assert.match(exports.feedbackFromError({ issue }).message, /750d8456/)
  assert.equal(
    exports.issueMessage({ ...issue, errorId: "Bearer private-token" }),
    issue.summary
  )
  assert.equal(
    exports.feedbackFromError(
      new Error("https://private.invalid/api?token=secret")
    ).message,
    "本次操作未完成，请重试。"
  )
})
