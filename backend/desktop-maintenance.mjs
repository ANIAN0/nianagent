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
    this.changes = Promise.resolve()
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
    const activities = [
      ...(ready?.conversations.maintenanceActivities() ?? []),
      ...(ready?.jobs.maintenanceActivities() ?? []),
    ]
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
    const change = this.changes.then(() => this.change(input))
    this.changes = change.then(
      () => {},
      () => {}
    )
    return change
  }
  async change(input) {
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
      await this.service()?.plugins.resume()
      if (this.service())
        this.service().conversations.setMaintenanceFrozen(false)
      this.operationId = null
      return this.state(input.operationId)
    }
    this.operationId = input.operationId
    if (this.service()) this.service().conversations.setMaintenanceFrozen(true)
    await this.service()?.plugins.freeze()
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
      await ready?.conversations.stopForMaintenance()
      await ready?.jobs.stopForMaintenance()
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
    await Promise.allSettled(requests.map((request) => request.done))
    const verifySaved = ready?.conversations.maintenanceCheckpoint()
    verifySaved?.()
    this.closed = true
    await ready?.close({ strict: true })
    verifySaved?.()
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
