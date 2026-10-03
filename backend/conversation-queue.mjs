import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { createHash, randomUUID } from "node:crypto"

const check = (value, message) => { if (!value) throw new Error(message) }
const fingerprint = (text, materials) => createHash("sha256").update(JSON.stringify([text, materials.map(({ id }) => id)])).digest("hex")
const active = (item) => ["pending", "dispatching", "failed"].includes(item.status)
const validId = (id) => check(typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id) && !["__proto__", "constructor", "prototype"].includes(id), "队列标识无效。")
const messageText = (message) => typeof message.content === "string" ? message.content : (message.content || []).filter((p) => p.type === "text").map((p) => p.text).join("\n")

/** Moon owns editable, durable pending inputs. Pi owns delivery boundaries and history. */
export class ConversationQueue {
  constructor(directory, conversations) {
    this.directory = join(directory, "conversations", "queue")
    this.conversations = conversations
    this.writes = new Map()
  }
  async load(state) {
    validId(state.record.id)
    let queue
    try { queue = JSON.parse(await readFile(join(this.directory, `${state.record.id}.json`), "utf8")) }
    catch (error) {
      if (error.code !== "ENOENT") throw new Error("待处理消息文件损坏或无法读取；原文件未覆盖。", { cause: error })
      queue = { version: 1, revision: 0, mode: "single", paused: false, items: [] }
    }
    check(queue.version === 1 && Number.isSafeInteger(queue.revision) && ["single", "all"].includes(queue.mode) && typeof queue.paused === "boolean" && Array.isArray(queue.items), "待处理消息文件结构损坏；原文件未覆盖。")
    const ids = new Set()
    for (const item of queue.items) {
      validId(item.id); validId(item.clientRequestId)
      check(!ids.has(item.id) && typeof item.text === "string" && item.text.length <= 100000 && Array.isArray(item.materials) && ["pending", "dispatching", "failed", "delivered", "removed"].includes(item.status) && ["followUp", "steer"].includes(item.delivery), "待处理消息记录损坏；原文件未覆盖。")
      ids.add(item.id)
    }
    state.queue = queue
    state.queuePrepared = new Map()
    await this.reconcile(state)
  }
  async reconcile(state) {
    const queue = state.queue
    // A request marker followed by its real user entry is the saved receipt even
    // when the process died between Pi's append and the outbox rename.
    const delivered = new Set()
    let request
    for (const entry of state.manager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "moon-request") request = entry.data?.clientRequestId
      if (entry.type === "message" && entry.message.role === "user") { if (request) delivered.add(request); request = undefined }
    }
    let changed = false
    for (const item of queue.items) {
      if (active(item) && delivered.has(item.clientRequestId)) { item.status = "delivered"; changed = true }
      else if (item.status === "dispatching") { item.status = "failed"; item.error = "上次交付未完成；已核对历史，确认后可继续发送此消息。"; changed = true }
    }
    if (queue.items.some(active)) { queue.paused = true; changed = true }
    if (changed) {
      queue.revision++
      state.queuePrepared.clear()
      await this.save(state)
    }
  }
  serialize(state, action) {
    const id = state.record.id
    const previous = this.writes.get(id) || Promise.resolve()
    const writing = previous.catch(() => {}).then(action)
    this.writes.set(id, writing)
    return writing.finally(() => { if (this.writes.get(id) === writing) this.writes.delete(id) })
  }
  save(state, signal) {
    // Capture only after preceding mutations have committed or rolled back.
    // A Pi receipt must not persist an uncommitted edit/mode candidate.
    return this.serialize(state, () => this.write(state, signal))
  }
  async write(state, signal) {
      const id = state.record.id
      const data = JSON.stringify(state.queue, null, 2)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temporary = join(this.directory, `.${id}-${randomUUID()}.tmp`)
      try {
        signal?.throwIfAborted()
        await writeFile(temporary, data, { flag: "wx", mode: 0o600 })
        signal?.throwIfAborted()
        await rename(temporary, join(this.directory, `${id}.json`))
      } finally { await rm(temporary, { force: true }) }
  }
  snapshot(state) {
    const queue = state.queue
    if (!queue) return undefined
    return { revision: queue.revision, mode: queue.mode, paused: queue.paused, acceptedRequestIds: queue.items.map((item) => item.clientRequestId), items: queue.items.filter(active).map(({ id, clientRequestId, text, materials, status, delivery, error, createdAt }) => ({ id, clientRequestId, text, materials, status, delivery, error, createdAt })) }
  }
  pending(state) { return !!state.queue?.items.some(active) }
  async commit(state, change, signal) {
    return this.serialize(state, async () => {
    const before = structuredClone(state.queue)
    change(state.queue)
    state.queue.revision++
    try { await this.write(state, signal) }
    catch (error) {
      // Pi can persist a dispatched user entry while this file write awaits IO.
      // Rolling that receipt back would resurrect an already delivered message.
      const delivered = new Set(state.queue.items.filter((item) => item.status === "delivered").map((item) => item.id))
      state.queue = before
      for (const item of before.items) if (delivered.has(item.id)) item.status = "delivered"
      for (const [id, value] of state.queuePrepared) {
        value.item = before.items.find((item) => item.id === id)
        if (!value.item || value.item.status === "delivered") state.queuePrepared.delete(id)
      }
      state.queue.paused = true
      state.queueError = "待处理消息保存失败，队列已暂停；请检查磁盘与权限后重试。"
      this.conversations.touch(state)
      throw error
    }
    this.conversations.touch(state)
    })
  }
  async enqueue(state, input, signal) {
    check(!state.controlBusy && !state.stopRequested && state.phase === "running", "会话暂不能排队，请等待控制操作结束。")
    check(!/^\/compact(?:\s|$)/.test(input.text.trim()), "压缩命令需要在空闲时执行。")
    const signature = fingerprint(input.text, input.materials || [])
    const existing = state.queue.items.find((item) => item.clientRequestId === input.clientRequestId)
    if (existing) { check(existing.fingerprint === signature, "提交标识已用于不同的队列内容。"); return }
    check(state.queue.items.filter(active).length < 100, "此会话已有100条待处理消息，请先处理队列。")
    await this.conversations.models.materials.resolveForPrompt({ sessionId: state.record.id, cwd: state.record.cwd, materials: input.materials || [], model: state.session.model, signal })
    await this.commit(state, (queue) => queue.items.push({ id: randomUUID(), clientRequestId: input.clientRequestId, fingerprint: signature, text: input.text, materials: input.materials || [], status: "pending", delivery: "followUp", error: "", createdAt: new Date().toISOString() }), signal)
  }
  enqueueReceipt(state, input) {
    const existing = state.queue.items.find((item) => item.clientRequestId === input.clientRequestId)
    check(existing?.fingerprint === fingerprint(input.text, input.materials || []), "提交标识已用于不同的队列内容。")
  }
  async mutate(sessionId, itemId, revision, change, signal) {
    validId(sessionId)
    return this.conversations.sessions.exclusive(sessionId, async () => {
      this.conversations.ensureOpen(); signal?.throwIfAborted()
      const record = await this.conversations.store.get(sessionId, signal)
      check(record, "会话不存在。")
      const state = await this.conversations.restore(record, undefined, signal)
      check(!state.controlBusy && state.phase !== "stopping", "会话控制操作尚未结束，请稍候。")
      check(state.queue.revision === revision, "队列已变化，请重新读取后操作。")
      const item = itemId ? state.queue.items.find((value) => value.id === itemId) : undefined
      if (itemId) check(item && ["pending", "failed"].includes(item.status), "消息已经交付或开始处理，不能再修改。")
      await this.commit(state, (queue) => change(queue, item), signal)
      return this.conversations.snapshot(state)
    })
  }
  edit(sessionId, itemId, text, revision, signal) {
    return this.mutate(sessionId, itemId, revision, (_queue, item) => {
      check(typeof text === "string" && text.length <= 100000 && (text.trim() || item.materials.length), "消息不能为空或超过100000字。")
      item.text = text; item.status = "pending"; item.error = ""
      // The immutable submission receipt retains the original fingerprint.
    }, signal)
  }
  remove(sessionId, itemId, revision, signal) { return this.mutate(sessionId, itemId, revision, (_queue, item) => { item.status = "removed"; item.error = "" }, signal) }
  mode(sessionId, mode, revision, signal) {
    check(["single", "all"].includes(mode), "消息交付模式无效。")
    return this.mutate(sessionId, undefined, revision, (queue) => { queue.mode = mode }, signal)
  }
  factory(state) {
    return (pi) => {
      pi.on("turn_end", async (event) => {
        if (event.outcome === "completed") await this.boundary(state, "steer")
      })
      pi.on("agent_before_settle", async (event) => {
        if (event.outcome === "completed") await this.boundary(state, "followUp")
      })
    }
  }
  async prepare(state, items, signal) {
    const prepared = []
    for (const item of items) {
      try {
        const materials = await this.conversations.models.materials.resolveForPrompt({ sessionId: state.record.id, cwd: state.record.cwd, materials: item.materials, model: state.session.model, signal })
        prepared.push({ item, materials, text: materials.textPrefix + (item.text || "请处理所附材料。") })
      } catch (error) {
        await this.commit(state, (queue) => { queue.paused = true; item.status = "failed"; item.error = error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message) ? error.message : "材料校验失败，请重新检查。" })
        return []
      }
    }
    return prepared
  }
  async boundary(state, delivery) {
    return this.conversations.sessions.exclusive(state.record.id, async () => {
      if (this.conversations.closed || state.stopRequested || state.controlBusy || state.queue.paused || !state.session?.isStreaming) return
      const waiting = state.queue.items.filter((item) => item.status === "pending" && item.delivery === delivery)
      const batch = delivery === "followUp" && state.queue.mode === "single" ? waiting.slice(0, 1) : waiting
      if (!batch.length) return
      const prepared = await this.prepare(state, batch)
      if (!prepared.length || state.stopRequested) return
      await this.commit(state, () => prepared.forEach(({ item }) => { item.status = "dispatching"; item.error = "" }))
      state.session.setFollowUpMode(state.queue.mode === "all" ? "all" : "one-at-a-time")
      state.session.setSteeringMode("all")
      for (const value of prepared) {
        state.queuePrepared.set(value.item.id, value)
        try {
          const disposition = await state.session[delivery](value.text, value.materials.images)
          check(disposition === "queued", "消息未进入 Pi 队列，请检查已启用扩展。")
        } catch (error) {
          state.session.clearQueue()
          await this.commit(state, (queue) => { queue.paused = true; prepared.forEach(({ item }) => { if (item.status === "dispatching") { item.status = "failed"; item.error = "交付失败，消息已保留，请检查后继续。" } }) })
          break
        }
      }
    })
  }
  beforeInput(state, message) {
    const text = messageText(message)
    const value = [...state.queuePrepared.values()].find((value) => value.item.status === "dispatching" && value.text === text)
    if (!value) return undefined
    const { item, materials } = value
    state.manager.appendCustomEntry("moon-request", { clientRequestId: item.clientRequestId, fingerprint: item.fingerprint, runId: state.record.runId, queueItemId: item.id })
    state.manager.appendCustomEntry("moon-materials", { clientRequestId: item.clientRequestId, text: item.text, materials: materials.displayMaterials })
    return value
  }
  afterInput(state, value) {
    if (!value) return
    value.item.status = "delivered"
    state.queuePrepared.delete(value.item.id)
    state.queue.revision++
    this.conversations.touch(state)
    void this.save(state).catch(() => { state.queue.paused = true; state.queueError = "待处理状态保存失败；交付已保存至历史，重新读取后核对。"; this.conversations.touch(state) })
  }
  inputStarted(state, message) {
    const text = messageText(message)
    const value = [...state.queuePrepared.values()].find((entry) => entry.item.status === "dispatching" && !entry.taken && entry.text === text)
    if (value) value.taken = true
  }
  async pause(state) {
    if (!this.pending(state)) return
    state.session?.clearQueue()
    await this.commit(state, (queue) => {
      queue.paused = true
      queue.items.forEach((item) => { if (item.status === "dispatching" && !state.queuePrepared.get(item.id)?.taken) { item.status = "pending"; item.error = "执行已停止或失败，此消息尚未交付。" } })
    })
    for (const [id, value] of state.queuePrepared) if (!value.taken) state.queuePrepared.delete(id)
  }
  async deliver(sessionId, itemId, revision, signal) {
    const snapshot = await this.mutate(sessionId, itemId, revision, (queue, item) => {
      queue.paused = false; item.delivery = "steer"; item.status = "pending"; item.error = ""
    }, signal)
    const state = this.conversations.active.get(sessionId)
    if (state.entry.busy) return snapshot
    // A user explicitly resumed an idle outbox. Start one SDK-owned run with all
    // selected user entries in SessionManager; no private Agent state mutation.
    void this.resume(state).catch((error) => { state.queue.paused = true; state.queueError = "队列启动失败，请重新读取后继续。"; this.conversations.touch(state) })
    return snapshot
  }
  async resume(state) {
    if (state.queue.paused || state.entry.busy || !this.pending(state) || this.conversations.closed) return
    const slash = state.record.modelId.indexOf("/")
    check(slash > 0, "此会话缺少有效模型，请先选择模型。")
    await this.conversations.start({ sessionId: state.record.id, clientRequestId: randomUUID(), workspaceId: state.record.workspaceId, connectionId: state.record.modelId.slice(0, slash), modelId: state.record.modelId.slice(slash + 1), thinking: state.record.thinking, text: "", materials: [], mode: "queue" })
  }
  async seed(state) {
    const steering = state.queue.items.filter((item) => item.status === "pending" && item.delivery === "steer")
    const waiting = state.queue.items.filter((item) => item.status === "pending" && item.delivery === "followUp")
    const batch = steering.length ? steering : state.queue.mode === "all" ? waiting : waiting.slice(0, 1)
    const prepared = await this.prepare(state, batch)
    check(prepared.length, "没有可交付的消息，请检查队列中的失败原因。")
    await this.commit(state, (queue) => { queue.paused = false; prepared.forEach(({ item }) => { item.status = "dispatching" }) })
    state.record = await this.conversations.store.update(state.record.id, { lastRequestId: prepared[0].item.clientRequestId, lastRequestFingerprint: prepared[0].item.fingerprint })
    for (const value of prepared) {
      state.queuePrepared.set(value.item.id, value)
      state.manager.appendMessage({ role: "user", content: [{ type: "text", text: value.text }, ...value.materials.images], timestamp: Date.now() })
    }
    state.session.refreshContext()
    await state.session.sendCustomMessage({ customType: "moon-queue-run", content: "请处理以上新提交的消息，保留每条要求和材料的归属。", display: false }, { triggerTurn: true })
  }
  async close() { await Promise.allSettled([...this.writes.values()]) }
}
