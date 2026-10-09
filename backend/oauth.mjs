import { settleResources } from "./close-resources.mjs"
import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent"
import { randomUUID, createHash } from "node:crypto"
import { operationError } from "./operation-issue.mjs"
const ownerEpoch = randomUUID()

export class AuthorizationJobs {
  constructor(service) {
    this.service = service
    this.jobs = new Map()
    this.closed = false
  }
  hasConnection(id) {
    return [...this.jobs.values()].some(
      (job) => job.connectionId === id && (!job.settled || job.cleanupError)
    )
  }
  hasProvider(id) {
    return [...this.jobs.values()].some(
      (job) =>
        job.state.connection.providerId === id &&
        (!job.settled || job.cleanupError)
    )
  }
  async start(connection, signal, operationRequestId) {
    if (this.closed) throw new Error("授权服务已关闭。")
    if (connection?.kind !== "subscription") throw new Error("请选择订阅连接。")
    const id = operationRequestId || randomUUID()
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      throw new Error("授权任务标识无效。")
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(connection))
      .digest("hex")
    const existing = this.jobs.get(id)
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw operationError(
          "authorization_identity_conflict",
          "此授权标识已用于另一份连接，请先核对原授权。",
          "check"
        )
      await existing.ready
      return this.poll(id)
    }
    this.service.assertAccountIdle?.(connection)
    if (this.hasConnection(connection.id))
      throw new Error("该连接正在授权，请先取消。")
    if (this.hasProvider(connection.providerId))
      throw new Error("该提供者的授权或清理尚未结束，请先取消或等待。")
    signal?.throwIfAborted()
    const controller = new AbortController()
    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // Register before saving/initializing: a caller that lost its response still
    // knows this ID and can cancel the preparation, not just an OAuth prompt.
    const job = {
      connectionId: connection.id,
      fingerprint,
      controller,
      ready,
      started: false,
      answer: null,
      state: {
        id,
        status: "pending",
        stage: "preparing",
        events: [],
        connection: {
          ...structuredClone(connection),
          apiKey: "",
          keySaved: false,
        },
      },
    }
    this.jobs.set(id, job)
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)
    timeout.unref()
    job.done = this.authorize(job, connection, signal, resolveReady)
      .then(async () => {
        job.state.connection =
          (await this.service.list()).find(
            (item) => item.id === job.connectionId
          ) || job.state.connection
        job.state.status = "complete"
      })
      .catch(async (error) => {
        if (!job.started) rejectReady(error)
        const cancelled =
          controller.signal.aborted || (!job.started && signal?.aborted)
        job.state.status = cancelled ? "cancelled" : "error"
        job.state.error = cancelled
          ? "授权已取消或超时。"
          : "订阅授权未完成，请核对连接后重试。"
        if (
          error instanceof CredentialSynchronizationError &&
          error.operation === "login" &&
          !controller.signal.aborted
        ) {
          try {
            const current = (await this.service.list()).find(
              (item) => item.id === job.connectionId
            )
            if (current?.account?.loggedIn) {
              job.state.connection = current
              job.state.status = "complete"
              delete job.state.error
            }
          } catch {
            /* Preserve the actual error when credentials cannot be read. */
          }
        }
      })
      .finally(async () => {
        try {
          await this.releaseLease(job)
        } catch (error) {
          job.cleanupError = error
          job.state.issue = {
            code: "authorization_cleanup",
            summary:
              "授权执行已结束，但本地授权锁未能释放，请核对原任务后重试取消。",
            recovery: "check",
            severity: "warning",
          }
        }
        clearTimeout(timeout)
        delete job.state.prompt
        job.answer = null
        job.settled = true
        if (!this.closed) {
          job.expiry = setTimeout(
            () => {
              if (!job.cleanupError) this.jobs.delete(id)
            },
            5 * 60 * 1000
          )
          job.expiry.unref()
        }
      })
    await ready
    return this.poll(id)
  }
  async authorize(job, connection, requestSignal, resolveReady) {
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, job.controller.signal])
      : job.controller.signal
    signal.throwIfAborted()
    await this.service.store.update((data) => {
      data.authorizationRequests ??= {}
      const existing = data.authorizationRequests[job.state.id]
      if (existing) {
        if (
          existing.fingerprint !== job.fingerprint ||
          existing.connectionId !== job.connectionId
        )
          throw operationError(
            "authorization_identity_conflict",
            "此授权标识已用于另一份连接，请先核对原授权。",
            "check"
          )
        throw operationError(
          "authorization_already_started",
          "原授权已启动过，请核对原任务及连接状态；不会再次授权。",
          "check"
        )
      }
      data.authorizationRequests[job.state.id] = {
        id: job.state.id,
        connectionId: job.connectionId,
        fingerprint: job.fingerprint,
        ownerEpoch,
        status: "pending",
        updatedAt: new Date().toISOString(),
      }
    }, signal)
    job.ownsIdentity = true
    signal.throwIfAborted()
    const saved = await this.service.save(connection, signal)
    job.state.connection = saved
    job.saved = saved
    signal.throwIfAborted()
    const id = job.state.id
    await this.service.store.update((data) => {
      if (data.authorizations[saved.providerId]?.expiresAt > Date.now())
        throw new Error("该提供者正在另一窗口授权。")
      if (
        !data.connections.some(
          (item) => item.id === saved.id && item.revision === saved.revision
        )
      )
        throw new Error("连接已修改，请重新授权。")
      data.authorizations[saved.providerId] = {
        id,
        connectionId: saved.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    }, signal)
    const runtime = await this.service.runtime(
      undefined,
      this.service.store.credentialStore({
        id,
        connectionId: saved.id,
        revision: saved.revision,
      })
    )
    signal.throwIfAborted()
    const deviceId = (await this.service.store.read()).deviceId
    signal.throwIfAborted()
    const login = runtime.login(
      saved.providerId,
      "oauth",
      {
        signal: job.controller.signal,
        notify: (event) => {
          job.state.events = [...job.state.events, event].slice(-20)
        },
        prompt: (prompt) =>
          new Promise((resolve, reject) => {
            const promptId = randomUUID()
            const { signal, ...visible } = prompt
            const cleanup = () => {
              signal?.removeEventListener("abort", abort)
              job.controller.signal.removeEventListener("abort", abort)
              delete job.state.prompt
              job.answer = null
            }
            const abort = () => {
              cleanup()
              reject(new DOMException("授权已取消", "AbortError"))
            }
            job.state.prompt = { ...visible, id: promptId }
            job.answer = (value) => {
              cleanup()
              resolve(value)
            }
            signal?.addEventListener("abort", abort, { once: true })
            job.controller.signal.addEventListener("abort", abort, {
              once: true,
            })
            if (signal?.aborted || job.controller.signal.aborted) abort()
          }),
      },
      { getDeviceId: () => deviceId }
    )
    job.started = true
    job.state.stage = "authorizing"
    resolveReady()
    await login
  }
  async releaseLease(job) {
    if (!job.ownsIdentity) return
    await this.service.store.update((data) => {
      if (
        job.saved &&
        data.authorizations[job.saved.providerId]?.id === job.state.id
      )
        delete data.authorizations[job.saved.providerId]
      const identity = data.authorizationRequests?.[job.state.id]
      if (
        identity?.ownerEpoch === ownerEpoch &&
        identity.fingerprint === job.fingerprint
      ) {
        identity.status = job.state.status
        identity.updatedAt = new Date().toISOString()
      }
    })
    job.cleanupError = undefined
    delete job.state.issue
  }
  poll(id) {
    const job = this.jobs.get(id)
    if (!job)
      throw operationError(
        "authorization_unknown",
        "原授权任务状态已不可读取，请核对已保存连接；不会重新开启授权。",
        "check"
      )
    const state = structuredClone(job.state)
    // The internal outcome is needed by the durable lease/identity cleanup.
    // Public terminal status must wait for that cleanup to settle, otherwise
    // callers can discard the original job ID before a cleanup failure appears.
    if (!job.settled && state.status !== "pending") {
      state.status = "pending"
      state.stage = "settling"
      delete state.prompt
      delete state.error
    }
    return state
  }
  reply(id, promptId, value) {
    const job = this.jobs.get(id)
    if (
      !job?.answer ||
      job.state.prompt?.id !== promptId ||
      typeof value !== "string" ||
      value.length > 16000
    )
      throw new Error("授权提示已失效，请刷新授权状态。")
    if (
      job.state.prompt.type === "select" &&
      !job.state.prompt.options.some((option) => option.id === value)
    )
      throw new Error("授权选项无效。")
    job.answer(value)
    return this.poll(id)
  }
  async cancel(id) {
    const job = this.jobs.get(id)
    if (!job) {
      const identity = (await this.service.store.read())
        .authorizationRequests?.[id]
      if (identity && identity.status !== "pending") return
      throw operationError(
        "authorization_unknown",
        "原授权执行状态不可确认，请核对连接；不能声称已取消未知任务。",
        "check"
      )
    }
    job.controller.abort()
    await job.done
    if (job.cleanupError) {
      try {
        await this.releaseLease(job)
      } catch {
        throw operationError(
          "authorization_cleanup",
          "授权执行已停止，但本地授权锁尚待释放，请核对原任务。",
          "check"
        )
      }
    }
  }
  async close({ strict = false } = {}) {
    this.closed = true
    const jobs = [...this.jobs.values()]
    for (const job of jobs) {
      clearTimeout(job.expiry)
      job.controller.abort()
    }
    await settleResources(
      jobs.map((job) => job.done),
      strict
    )
    if (strict && jobs.some((job) => job.cleanupError))
      throw new Error("授权资源清理未确认，请重启恢复。")
  }
}
