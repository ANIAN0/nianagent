import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement } from "react"
import { renderToString as renderMarkup } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"
let server,
  cache,
  store,
  HomeSubmissionEcho,
  TooltipProvider,
  ComposerPanelProvider,
  followingHomeDraft,
  recoverRejectedHomeDraft,
  adoptFollowingHomeDraft,
  lifecycle
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-home-submission-flow-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  store = await server.ssrLoadModule(
    "/src/features/conversation/conversation-draft-store.ts"
  )
  ;({ followingHomeDraft, recoverRejectedHomeDraft, adoptFollowingHomeDraft } =
    await server.ssrLoadModule("/src/features/home/home-submission-draft.ts"))
  ;({ HomeSubmissionEcho } = await server.ssrLoadModule(
    "/src/features/home/home-submission-echo.tsx"
  ))
  lifecycle = await server.ssrLoadModule(
    "/src/features/home/home-submission-lifecycle.ts"
  )
  ;({ TooltipProvider } = await server.ssrLoadModule(
    "/src/components/ui/tooltip.tsx"
  ))
  ;({ ComposerPanelProvider } = await server.ssrLoadModule(
    "/src/features/home/composer-panel-context.tsx"
  ))
})
function renderToString(element) {
  return renderMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ComposerPanelProvider, null, element)
    )
  )
}
test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-home-submission-flow-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

function storageFixture(t) {
  const values = new Map()
  const writes = []
  let fail = () => false
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes.push([key, value])
        if (fail(key, value)) throw new Error("storage unavailable")
        values.set(key, value)
      },
      removeItem: (key) => values.delete(key),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  return {
    values,
    writes,
    fail: (fn) => {
      fail = fn
    },
  }
}

const original = {
  sessionId: "first-session",
  workspaceId: "workspace",
  text: "原需求",
  model: "model",
  thinking: "高",
  materials: [
    {
      id: "file-a",
      name: "README.md",
      kind: "附件",
      type: "file",
      source: "README.md",
      status: "ready",
    },
  ],
  session: { toolIds: ["read"], instructionScope: "all" },
}

test("the durable original copy precedes a cleared next draft and is not mutated by editing", (t) => {
  const fixture = storageFixture(t)
  const submission = {
    ...store.createHomeSubmission(original),
    followingDraft: true,
  }
  const following = followingHomeDraft(original)
  store.prepareHomeSubmission(submission, following)
  assert.equal(fixture.writes[0][0], "moon.home.draft.v1.workspace")
  assert.equal(fixture.writes[1][0], "moon.home.submission.v1.first-session")
  assert.equal(JSON.parse(fixture.writes[2][1]).text, "")
  following.text = "下一条需求"
  following.session.toolIds.push("edit")
  store.saveHomeDraft(following)
  const restored = store.restoreHomeSubmissions()[submission.sessionId]
  assert.equal(restored.clientRequestId, submission.clientRequestId)
  assert.match(restored.clientRequestId, /^[a-f0-9-]{36}$/u)
  assert.equal(restored.draft.text, "原需求")
  assert.deepEqual(restored.draft.session.toolIds, ["read"])
  assert.equal(store.restoreHomeDraft("workspace").text, "下一条需求")
})

for (const phase of ["read", "apply"]) {
  test(`unknown ${phase} configuration receipt restores input without claiming a message was sent`, (t) => {
    storageFixture(t)
    const submission = store.createHomeSubmission(original)
    store.prepareHomeSubmission(submission, {
      ...followingHomeDraft(original),
      text: "下一条需求",
    })
    const transport = Object.assign(new Error("configuration unavailable"), {
      issue: {
        code: "result_unknown",
        summary: "无法确认配置结果",
        recovery: "check",
        severity: "warning",
      },
    })
    const failure = lifecycle.homePreflightError(transport, phase)
    assert.equal(failure.issue.code, "session_preflight")
    assert.equal(failure.issue.recovery, "reload")
    assert.match(failure.issue.summary, /消息尚未发送/u)
    const recovered = store.recoverRejectedHomeSubmission(submission)
    assert.equal(recovered.draft.text, "原需求\n\n下一条需求")
    store.removeHomeSubmission(submission.sessionId)
    assert.equal(
      store.restoreHomeSubmissions()[submission.sessionId],
      undefined
    )
  })
}

test("preflight preserves restart and neutral cancellation while never offering send reconciliation", () => {
  const restart = lifecycle.homePreflightError(
    Object.assign(new Error("old host"), {
      issue: {
        code: "host_version",
        summary: "需要重新启动服务",
        recovery: "restart",
        severity: "warning",
      },
    }),
    "read"
  )
  assert.equal(restart.issue.recovery, "restart")
  assert.equal(restart.issue.code, "session_preflight")
  const cancelled = new DOMException("已取消", "AbortError")
  assert.equal(lifecycle.homePreflightError(cancelled, "apply"), cancelled)
})

for (const status of ["ready", "failed"]) {
  test(`an accepted input waits for next material to become ${status} before freezing and handing off`, (t) => {
    storageFixture(t)
    const submission = store.createHomeSubmission(original)
    const placeholder = {
      id: "preparing:local-image",
      name: "次稿图片.png",
      kind: "附件",
      type: "image",
      source: "粘贴或拖入的图片",
      status: "preparing",
    }
    const next = {
      ...followingHomeDraft(original),
      text: "下一条需求",
      materials: [placeholder],
    }
    store.prepareHomeSubmission(submission, next)
    assert.throws(
      () => store.recordHomeTransfer(submission, next),
      /尚未准备完成/u
    )
    assert.equal(
      store.restoreHomeSubmissions()[submission.sessionId].transfer,
      undefined
    )
    let retained = lifecycle.retainPreparingHomeView({}, next, 7, true)
    assert.equal(retained[7].draft.materials[0].id, placeholder.id)
    const settled = {
      ...next,
      materials: [
        {
          ...placeholder,
          status,
          ...(status === "ready"
            ? { id: "f".repeat(64) }
            : { error: "保存暂时失败", retryable: true }),
        },
      ],
    }
    retained = lifecycle.retainPreparingHomeView(retained, settled, 7, true)
    assert.deepEqual(retained, {})
    const handoff = store.recordHomeTransfer(submission, settled)
    store.saveConversationDraft(
      submission.sessionId,
      adoptFollowingHomeDraft(handoff, handoff.transfer.draft)
    )
    store.finishHomeSubmission(handoff, undefined, true)
    const adopted =
      store.restoreConversationDrafts().drafts[submission.sessionId]
    assert.equal(adopted.text, next.text)
    assert.equal(adopted.materials[0].status, status)
    if (status === "failed")
      assert.equal(adopted.materials[0].error, "保存暂时失败")
  })
}

test("native selection retains its owner before any named material exists; hidden changes cannot overwrite B", () => {
  const following = followingHomeDraft(original)
  let retained = lifecycle.retainPreparingHomeView({}, following, 4, true, true)
  assert.equal(retained[4].draft.materials.length, 0)
  const other = {
    key: 9,
    draft: {
      ...following,
      sessionId: "other",
      workspaceId: "other-workspace",
      text: "B 的输入",
    },
  }
  assert.equal(
    lifecycle.changeOwnedHomeCache(
      other,
      { ...following, text: "A 的材料结果" },
      4
    ),
    other
  )
  assert.equal(lifecycle.nextHomeViewKey({ key: 1 }, retained), 5)
  retained = lifecycle.retainPreparingHomeView(
    retained,
    following,
    4,
    true,
    false
  )
  assert.deepEqual(retained, {})
})

test("refusal preserves a still-running next preparation under the same Home identity", (t) => {
  storageFixture(t)
  const submission = store.createHomeSubmission(original)
  const preparing = {
    id: "preparing:next",
    name: "次稿图片.png",
    kind: "附件",
    type: "image",
    source: "粘贴或拖入的图片",
    status: "preparing",
  }
  const next = {
    ...followingHomeDraft(original),
    text: "等待时的新需求",
    materials: [preparing],
  }
  store.prepareHomeSubmission(submission, next)
  const recovery = store.recoverRejectedHomeSubmission(submission, next)
  assert.equal(recovery.draft.sessionId, submission.sessionId)
  assert.equal(recovery.draft.text, "原需求\n\n等待时的新需求")
  assert.equal(recovery.draft.materials[1].id, preparing.id)
  const retained = lifecycle.retainPreparingHomeView(
    {},
    recovery.draft,
    4,
    true
  )
  assert.equal(retained[4].key, 4)
  assert.equal(
    lifecycle.changeOwnedHomeCache({ key: 4 }, recovery.draft, 4).key,
    4
  )
})

test("a clear-draft storage failure cannot discard the original or permit a remote start", (t) => {
  const fixture = storageFixture(t)
  const submission = store.createHomeSubmission(original)
  fixture.fail(
    (key, value) =>
      key.startsWith("moon.home.draft") && JSON.parse(value).text === ""
  )
  assert.throws(() =>
    store.prepareHomeSubmission(submission, followingHomeDraft(original))
  )
  assert.equal(store.restoreHomeDraft("workspace").text, "原需求")
  assert.equal(store.restoreHomeSubmissions()[submission.sessionId], undefined)
})

test("a definitive refusal automatically preserves original and next text/materials", (t) => {
  storageFixture(t)
  const submission = store.createHomeSubmission(original)
  const following = {
    ...followingHomeDraft(original),
    text: "下一条需求",
    materials: [
      original.materials[0],
      {
        id: "file-b",
        name: "DESIGN.md",
        kind: "附件",
        source: "DESIGN.md",
        type: "file",
      },
    ],
  }
  store.prepareHomeSubmission(submission, following)
  const restored = store.recoverRejectedHomeSubmission(submission)
  assert.equal(restored.draft.text, "原需求\n\n下一条需求")
  assert.deepEqual(
    restored.draft.materials.map((item) => item.id),
    ["file-a", "file-b"]
  )
  assert.equal(restored.merged, true)
  assert.equal(store.restoreHomeDraft("workspace").text, restored.draft.text)
  // The immutable copy is removed by the owner only after this recovery succeeded.
  assert.ok(store.restoreHomeSubmissions()[submission.sessionId])
  assert.equal(recoverRejectedHomeDraft(submission, original).merged, false)
  const retry = store.recoverRejectedHomeSubmission(submission)
  assert.equal(retry.draft.text, "原需求\n\n下一条需求")
  assert.deepEqual(
    retry.draft.materials.map((item) => item.id),
    ["file-a", "file-b"]
  )
})

test("two different uploaded images with the same display source survive refusal and acceptance", (t) => {
  storageFixture(t)
  const first = {
    id: "image-a",
    name: "first.png",
    kind: "附件",
    type: "image",
    source: "粘贴或拖入的图片",
    status: "ready",
  }
  const second = { ...first, id: "image-b", name: "second.png" }
  const submission = store.createHomeSubmission({
    ...original,
    materials: [first],
  })
  const following = {
    ...followingHomeDraft(original),
    text: "下一条需求",
    materials: [second],
  }
  const recovery = recoverRejectedHomeDraft(submission, following)
  assert.deepEqual(
    recovery.draft.materials.map((item) => item.id),
    ["image-a", "image-b"]
  )
  const existing = {
    ...original,
    text: "会话中已编辑的内容",
    materials: [first],
  }
  const adopted = adoptFollowingHomeDraft(submission, following, existing)
  assert.deepEqual(
    adopted.materials.map((item) => item.id),
    ["image-a", "image-b"]
  )
})

test("a new attempt can restore its new original after an earlier refusal used the same Home ID", (t) => {
  storageFixture(t)
  const first = store.createHomeSubmission(original)
  const recovery = recoverRejectedHomeDraft(first, {
    ...followingHomeDraft(original),
    text: "下一条需求",
  })
  const retry = store.createHomeSubmission(recovery.draft)
  const following = followingHomeDraft(recovery.draft)
  assert.equal(following.homeRecoveryKey, undefined)
  assert.equal(
    recoverRejectedHomeDraft(retry, following).draft.text,
    "原需求\n\n下一条需求"
  )
})

test("acceptance hands the next input to the same conversation and cleanup retries are idempotent", (t) => {
  storageFixture(t)
  const submission = store.createHomeSubmission(original)
  const following = { ...followingHomeDraft(original), text: "下一条需求" }
  store.prepareHomeSubmission(submission, following)
  const handoff = store.recordHomeTransfer(submission)
  const conversation = adoptFollowingHomeDraft(
    handoff,
    handoff.transfer.draft,
    original
  )
  assert.equal(conversation.text, "下一条需求")
  assert.equal(conversation.sessionId, submission.sessionId)
  assert.equal(conversation.homeTransferId, submission.sessionId)
  store.saveConversationDraft(conversation.sessionId, conversation)
  const editing = { ...conversation, text: "下一条需求，继续补充" }
  assert.deepEqual(
    adoptFollowingHomeDraft(handoff, following, editing),
    editing
  )
  store.finishHomeSubmission(handoff, undefined, true)
  assert.deepEqual(store.restoreHomeDraft("workspace"), {})
  assert.equal(
    store.restoreConversationDrafts().drafts[submission.sessionId].text,
    "下一条需求"
  )
})

test("failure saving the target conversation leaves both Home source and immutable record recoverable", (t) => {
  const fixture = storageFixture(t)
  const submission = store.createHomeSubmission(original)
  const following = { ...followingHomeDraft(original), text: "下一条需求" }
  store.prepareHomeSubmission(submission, following)
  const handoff = store.recordHomeTransfer(submission)
  fixture.fail((key) => key.startsWith("moon.chat.draft"))
  assert.throws(() =>
    store.saveConversationDraft(
      submission.sessionId,
      adoptFollowingHomeDraft(handoff, following)
    )
  )
  assert.equal(store.restoreHomeDraft("workspace").text, "下一条需求")
  assert.equal(
    store.restoreHomeSubmissions()[submission.sessionId].draft.text,
    "原需求"
  )
  assert.equal(
    store.restoreHomeSubmissions()[submission.sessionId].transfer.draft.text,
    "下一条需求"
  )
})

test("a selectively failed Home write cannot hand off stale storage and discard the latest editor", (t) => {
  const fixture = storageFixture(t)
  const submission = store.createHomeSubmission(original)
  store.prepareHomeSubmission(submission, followingHomeDraft(original))
  const editing = {
    ...followingHomeDraft(original),
    text: "尚未写入本机的下一条需求",
  }
  fixture.fail((key) => key.startsWith("moon.home.draft"))
  assert.throws(() => store.recordHomeTransfer(submission, editing))
  assert.equal(
    store.restoreHomeSubmissions()[submission.sessionId].transfer,
    undefined
  )
  assert.equal(
    store.restoreHomeSubmissions()[submission.sessionId].draft.text,
    "原需求"
  )
  fixture.fail(() => false)
  const handoff = store.recordHomeTransfer(submission, editing)
  assert.equal(handoff.transfer.draft.text, editing.text)
  assert.equal(store.restoreHomeDraft("workspace").text, editing.text)
})

test("definitive refusal restores the latest in-memory draft instead of an older durable one", (t) => {
  storageFixture(t)
  const submission = store.createHomeSubmission(original)
  store.prepareHomeSubmission(submission, followingHomeDraft(original))
  const editing = {
    ...followingHomeDraft(original),
    text: "窗口里尚未保存的下一条需求",
  }
  const recovered = store.recoverRejectedHomeSubmission(submission, editing)
  assert.equal(recovered.draft.text, "原需求\n\n窗口里尚未保存的下一条需求")
  assert.equal(store.restoreHomeDraft("workspace").text, recovered.draft.text)
})

test("unknown receipt reload restores separate original and next input without replaying either", (t) => {
  storageFixture(t)
  const submission = {
    ...store.createHomeSubmission(original),
    followingDraft: true,
  }
  store.prepareHomeSubmission(submission, {
    ...followingHomeDraft(original),
    text: "下一条需求",
  })
  const restored = store.restoreHomeSubmissions()[submission.sessionId]
  const next = store.restoreHomeDraft("workspace")
  assert.equal(restored.draft.text, "原需求")
  assert.equal(next.text, "下一条需求")
  assert.equal(next.sessionId, restored.sessionId)
})

test("Home's original submission uses a closed recovery action without inventing message history", () => {
  const submission = store.createHomeSubmission(original)
  const html = renderToString(
    createElement(HomeSubmissionEcho, { submission, workspacePath: "/demo" })
  )
  assert.match(
    html,
    /<button\b(?=[^>]*aria-label="核对原消息")(?=[^>]*type="button")(?=[^>]*data-state="closed")[^>]*>/u
  )
  assert.doesNotMatch(
    html,
    /data-slot="message"|data-slot="bubble"|原需求|正在确认发送|复制消息|消息信息|<time/u
  )
  assert.doesNotMatch(html, /<button\b[^>]*type="submit"/u)
})

test("prepared and known-rejected recovery phases remain durable without a model request", (t) => {
  storageFixture(t)
  const submission = store.createHomeSubmission(original)
  assert.equal(submission.stage, "prepared")
  store.prepareHomeSubmission(submission, followingHomeDraft(original))
  assert.equal(
    store.restoreHomeSubmissions()[submission.sessionId].stage,
    "prepared"
  )
  const refused = { ...submission, stage: "rejected" }
  store.saveHomeSubmission(refused)
  assert.equal(
    store.restoreHomeSubmissions()[submission.sessionId].stage,
    "rejected"
  )
  const recovery = store.recoverRejectedHomeSubmission(refused)
  assert.equal(recovery.draft.text, original.text)
})
test("accepted handoff persists positive receipt phase for local-only cleanup after restart", (t) => {
  storageFixture(t)
  const submission = store.createHomeSubmission(original)
  store.prepareHomeSubmission(submission, followingHomeDraft(original))
  const handoff = store.recordHomeTransfer(submission)
  assert.equal(handoff.stage, "accepted")
  assert.equal(
    store.restoreHomeSubmissions()[submission.sessionId].stage,
    "accepted"
  )
})

test("a hidden owner remains alive after materials settle until external refusal recovery is acknowledged", () => {
  const preparing = {
    ...followingHomeDraft(original),
    materials: [
      {
        id: "preparing:image",
        type: "image",
        name: "image.png",
        status: "preparing",
      },
    ],
  }
  const held = lifecycle.retainPreparingHomeView({}, preparing, 12, true)
  const settled = {
    ...preparing,
    text: "新增内容",
    materials: [
      { ...preparing.materials[0], status: "failed", retryable: true },
    ],
  }
  const awaiting = lifecycle.retainPreparingHomeView(
    held,
    settled,
    12,
    false,
    false,
    true
  )
  assert.equal(awaiting[12].draft.text, settled.text)
  assert.equal(awaiting[12].draft.materials[0].status, "failed")
  const restored = recoverRejectedHomeDraft(
    store.createHomeSubmission(original),
    settled
  )
  const completed = lifecycle.retainPreparingHomeView(
    awaiting,
    restored.draft,
    12,
    false,
    false,
    false
  )
  assert.equal(completed[12], undefined)
  assert.equal(restored.draft.text, "原需求\n\n新增内容")
  assert.equal(
    recoverRejectedHomeDraft(
      store.createHomeSubmission(original),
      restored.draft
    ).draft.text,
    restored.draft.text
  )
})
