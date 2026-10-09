import { operationError } from "./operation-issue.mjs"

// 白名单只允许不会启动新副作用的读取，以及用户已确认的停止/原回执核对。
const allowedWhileFrozen = new Set([
  "conversationStop",
  "authCancel",
  "authPoll",
  "conversationQueueReceiptRead",
  "conversationCommandRead",
  "writeReceiptRead",
])
export class DesktopMaintenance {
  constructor(service, requests) {
    this.service = service
    this.requests = requests
    this.operationId = null
    this.closed = false
    this.draining = false
  }
  accepts(operation) {
    return (
      !this.closed &&
      !this.draining &&
      (!this.operationId || allowedWhileFrozen.has(operation))
    )
  }
  activities() {
    const ready = this.service()
    const activities = []
    for (const [id, state] of ready?.conversations.active || []) {
      if (
        state.entry?.busy ||
        state.controlBusy ||
        state.phase === "running" ||
        state.phase === "stopping"
      )
        activities.push({
          id,
          kind: "conversation",
          label: state.record.title || "运行中的会话",
          sessionId: id,
          stoppable: true,
        })
    }
    for (const [id, job] of ready?.jobs.jobs || []) {
      if (!job.settled || job.cleanupError)
        activities.push({
          id,
          kind: "authorization",
          label: "进行中的模型授权",
          sessionId: null,
          stoppable: true,
        })
    }
    for (const [id, request] of this.requests) {
      if (
        request.operation !== "$maintenance" &&
        !allowedWhileFrozen.has(request.operation)
      )
        activities.push({
          id,
          kind: "request",
          label: "正在完成已接受的业务请求",
          sessionId: request.sessionId || null,
          stoppable: false,
        })
    }
    return activities
  }
  async execute(input) {
    if (
      !input ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId || "") ||
      !["inspect", "freeze", "resume", "prepareShutdown"].includes(input.action)
    )
      throw operationError("maintenance_unconfirmed", "维护请求无效。")
    if (input.action === "inspect") return this.state(input.operationId)
    if (this.operationId && this.operationId !== input.operationId)
      throw operationError(
        "maintenance_busy",
        "另一个维护操作正在进行。",
        "reload"
      )
    if (input.action === "resume") {
      if (this.closed || this.draining)
        throw operationError(
          "maintenance_unconfirmed",
          "服务已进入关闭阶段，只能重新启动恢复。"
        )
      this.operationId = null
      if (this.service()) this.service().conversations.maintenanceFrozen = false
      return this.state(input.operationId)
    }
    this.operationId = input.operationId
    if (this.service()) this.service().conversations.maintenanceFrozen = true
    if (input.action === "freeze") return this.state(input.operationId)
    const ready = this.service()
    const conversations = this.activities().filter(
      (activity) => activity.kind === "conversation"
    )
    if (conversations.length && !input.stopActive)
      throw operationError(
        "maintenance_unconfirmed",
        "会话仍在运行，请稍后维护或明确停止。"
      )
    if (input.stopActive) {
      // 明确停止也覆盖手动压缩等控制任务，不能只停止普通Pi prompt。
      await ready?.conversations.controls.close({ strict: true })
      for (const activity of conversations) {
        const state = ready.conversations.active.get(activity.id)
        if (state.entry?.busy)
          await ready.conversations.stop(activity.id, state.record.runId)
        // stop只表示接受停止；必须等待Pi运行和落盘真正完成。
        await state.run
        if (state.entry?.busy || state.controlBusy)
          throw operationError(
            "maintenance_unconfirmed",
            "尚不能确认会话已停止。"
          )
      }
      for (const [id, job] of ready?.jobs.jobs || [])
        if (!job.settled || job.cleanupError) await ready.jobs.cancel(id)
    }
    const authorization = this.activities().filter(
      (activity) => activity.kind === "authorization"
    )
    if (authorization.length)
      throw operationError(
        "maintenance_unconfirmed",
        "授权尚未结束，请先完成或取消授权。"
      )
    // 最后关闭阶段拒绝所有新业务请求，并排空所有已接受入口；读操作也可能持有资源。
    this.draining = true
    const requests = [...this.requests.values()]
    await Promise.all(requests.map((request) => request.done))
    for (const state of ready?.conversations.active.values() || []) {
      if (
        state.maintenanceSaveError ||
        state.historyError ||
        ready.conversations.persistence.get(state.manager)?.error
      )
        throw operationError(
          "maintenance_unconfirmed",
          "会话或队列存在未确认保存的内容，请重新启动 Moon 后核对原记录；不会继续迁移或安装。"
        )
    }
    // 严格关闭汇总错误；不能把allSettled吞掉的失败当作安全保存。
    const savedStates = [...(ready?.conversations.active.values() || [])]
    this.closed = true
    await ready?.close({ strict: true })
    if (
      savedStates.some(
        (state) =>
          state.maintenanceSaveError ||
          state.historyError ||
          ready.conversations.persistence.get(state.manager)?.error
      )
    )
      throw operationError(
        "maintenance_unconfirmed",
        "关闭期间仍有未确认保存的会话或回执，原身份保留，请重新启动恢复。"
      )
    return this.state(input.operationId)
  }
  state(operationId) {
    return {
      operationId,
      frozen: Boolean(this.operationId),
      closed: this.closed,
      activities: this.activities(),
    }
  }
}
