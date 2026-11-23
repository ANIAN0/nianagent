import test from "node:test"
import assert from "node:assert/strict"
import { ESLint } from "eslint"
import { operations } from "./contract.mjs"
import {
  assertRegistryCovers,
  mergeOperationGroups,
  serviceRoot,
} from "./service-registry.mjs"
import { DesktopMaintenance } from "./desktop-maintenance.mjs"
import { ConversationService } from "./conversations.mjs"
import { AuthorizationJobs } from "./oauth.mjs"
import { SessionService } from "./sessions.mjs"

test("实际操作目录覆盖、未知owner及重复操作拒绝", () => {
  assertRegistryCovers(operations)
  assert.throws(
    () => assertRegistryCovers({ broken: { method: "missing.run" } }),
    /未注册/
  )
  assert.throws(() => serviceRoot("missing.run"), /未注册/)
  assert.throws(
    () => mergeOperationGroups({ call: {} }, { call: {} }),
    /重复注册/
  )
  assert.deepEqual(Object.keys(mergeOperationGroups({ a: {} }, { b: {} })), [
    "a",
    "b",
  ])
})

test("所有插件包括新增插件、深层动态入口及TS运行时依赖执行同一边界", async () => {
  const lint = new ESLint()
  const samples = [
    [
      "backend/plugins/new-plugin/deep/file.mjs",
      'import "../../../models.mjs"',
      true,
    ],
    [
      "backend/plugins/new-plugin/deep/file.mjs",
      'await import("../../../models.mjs")',
      true,
    ],
    [
      "backend/plugins/new-plugin/file.mjs",
      'export * from "../notes-workbench/host.mjs"',
      true,
    ],
    [
      "backend/plugins/new-plugin/file.mjs",
      'import "../../services.mjs"',
      true,
    ],
    ["backend/plugins/new-plugin/file.mjs", 'import "../../logger.mjs"', false],
    [
      "backend/plugins/new-plugin/file.mjs",
      'await import("./internal.mjs")',
      false,
    ],
    [
      "backend/plugins/new-plugin/web.tsx",
      'import "../notes-workbench/src/main"',
      true,
    ],
    [
      "backend/plugins/new-plugin/web.tsx",
      'import "@/features/home/home"',
      true,
    ],
    [
      "backend/plugins/new-plugin/web.tsx",
      'import "@/components/ui/button"',
      false,
    ],
    [
      "backend/plugins/new-plugin/web.tsx",
      'import type { PluginWebModule } from "@/features/plugins/plugin-api"; export type X = PluginWebModule',
      false,
    ],
  ]
  for (const [filePath, code, denied] of samples) {
    const result = await lint.lintText(code, { filePath })
    assert.equal(
      result[0].messages.some(
        (item) => item.ruleId === "moon-boundary/boundary"
      ),
      denied,
      `${filePath}: ${code}`
    )
  }
})

test("核心与下层模块执行方向性边界，防止新增跨边界直连", async () => {
  const lint = new ESLint()
  const samples = [
    [
      "src/features/workspaces/new-workspace.ts",
      'import "../../../backend/plugins/remote-access/client"',
      true,
    ],
    ["src/lib/new-helper.ts", 'import "@/features/home/home-page"', true],
    [
      "src/components/feedback/new-feedback.tsx",
      'import "@/components/composer/send-control"',
      true,
    ],
    [
      "src/features/home/new-home.tsx",
      'import "@/features/conversation/conversation-page"',
      true,
    ],
    ["backend/workspaces-extra.mjs", 'import "./models.mjs"', true],
    [
      "src/features/home/new-home.tsx",
      'import "@/lib/operation-issue"; import "@/components/ui/button"',
      false,
    ],
    [
      "src/features/settings/settings-page.tsx",
      'import "@/features/models/model-settings-page"',
      false,
    ],
  ]
  for (const [filePath, code, denied] of samples) {
    const result = await lint.lintText(code, { filePath })
    assert.equal(
      result[0].messages.some(
        (item) => item.ruleId === "moon-boundary/layering"
      ),
      denied,
      `${filePath}: ${code}`
    )
  }
})

test("维护只使用领域活动/停止/保存核验端口，不依赖私有Map", async () => {
  const calls = []
  let active = true,
    authorization = true
  const service = {
    plugins: {
      freeze: async () => calls.push("freeze"),
      resume: async () => calls.push("resume"),
    },
    conversations: {
      setMaintenanceFrozen: (value) => calls.push(`frozen:${value}`),
      maintenanceActivities: () =>
        active ? [{ id: "session", kind: "conversation" }] : [],
      stopForMaintenance: async () => {
        active = false
        calls.push("stop-conversation")
      },
      maintenanceCheckpoint: () => () => calls.push("verify-saved"),
    },
    jobs: {
      maintenanceActivities: () =>
        authorization ? [{ id: "auth", kind: "authorization" }] : [],
      stopForMaintenance: async () => {
        authorization = false
        calls.push("stop-auth")
      },
    },
    close: async () => calls.push("close"),
  }
  const maintenance = new DesktopMaintenance(() => service, new Map())
  assert.equal(maintenance.activities().length, 2)
  await maintenance.execute({ operationId: "m", action: "freeze" })
  assert.equal(maintenance.accepts("conversationSend"), false)
  assert.equal(maintenance.accepts("conversationStop"), true)
  await assert.rejects(
    maintenance.execute({ operationId: "other", action: "resume" }),
    /另一个维护/
  )
  await assert.rejects(
    maintenance.execute({ operationId: "m", action: "prepareShutdown" }),
    /会话仍在运行/
  )
  const result = await maintenance.execute({
    operationId: "m",
    action: "prepareShutdown",
    stopActive: true,
  })
  assert.equal(result.closed, true)
  assert.deepEqual(calls.slice(-5), [
    "stop-conversation",
    "stop-auth",
    "verify-saved",
    "close",
    "verify-saved",
  ])
  await assert.rejects(
    maintenance.execute({ operationId: "m", action: "resume" }),
    /关闭阶段/
  )
})

test("领域快照不暴露状态引用，关闭后仍能核对迟到保存失败", () => {
  const state = {
    entry: { busy: true },
    record: { title: "原标题" },
    manager: {},
  }
  const conversation = Object.create(ConversationService.prototype)
  conversation.active = new Map([["s", state]])
  conversation.persistence = new WeakMap()
  const snapshot = conversation.maintenanceActivities()
  snapshot[0].label = "外部修改"
  assert.equal(state.record.title, "原标题")
  const verify = conversation.maintenanceCheckpoint()
  conversation.active.clear()
  verify()
  conversation.persistence.set(state.manager, { error: new Error("磁盘失败") })
  assert.throws(verify, /未确认保存/)
  const jobs = new AuthorizationJobs({})
  jobs.jobs.set("pending", { settled: false })
  jobs.jobs.set("done", { settled: true })
  jobs.jobs.set("failed-cleanup", {
    settled: true,
    cleanupError: new Error("清理失败"),
  })
  assert.deepEqual(
    jobs.maintenanceActivities().map((item) => item.id),
    ["pending", "failed-cleanup"]
  )
})

test("会话运行实例由所属模块替换，旧实例迟到清理不能删除新实例", () => {
  const sessions = new SessionService("fixture", {})
  let disposed = 0
  const old = {
    busy: false,
    session: { isIdle: true, dispose: () => disposed++ },
  }
  const current = {
    busy: true,
    session: {
      isIdle: false,
      dispose() {},
      extensionRunner: { name: "current" },
    },
  }
  sessions.adoptRuntime("session", old)
  sessions.adoptRuntime("session", current)
  assert.equal(disposed, 1)
  assert.equal(sessions.detachRuntime("session", old), false)
  assert.equal(sessions.commandRunner("session").name, "current")
  assert.equal(sessions.hasBusyWork(), true)
  assert.equal(sessions.detachRuntime("session", current), true)
  assert.equal(sessions.hasBusyWork(), false)
})

test("工具目录只读一次 MCP 缓存，且不创建完整 Pi 会话", async () => {
  const tool = {
    id: "mcp__fixture__list",
    name: "样本工具",
    description: "读取样本目录",
    group: "MCP · 样本",
    detail: "已验证缓存",
    available: true,
    unavailableReason: "",
  }
  let reads = 0
  const sessions = new SessionService(process.env.TEMP ?? process.cwd(), {
    mcp: {
      async catalog() {
        reads++
        return [tool]
      },
    },
    runtime() {
      throw new Error("目录查询不应创建模型运行时")
    },
  })
  try {
    const result = await sessions.catalog(process.cwd())
    assert.equal(reads, 1)
    assert.equal(result.tools.filter(({ id }) => id === tool.id).length, 1)
    assert.ok(result.defaults.toolIds.includes(tool.id))
    assert.ok(result.defaults.toolIds.includes("read"))
    assert.equal(sessions.active.size, 0)
  } finally {
    await sessions.close()
  }
})
