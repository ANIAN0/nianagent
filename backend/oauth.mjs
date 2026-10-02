import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent"
import { randomUUID } from "node:crypto"

export class AuthorizationJobs {
  constructor(service) {
    this.service = service
    this.jobs = new Map()
  }
  hasConnection(id) {
    return [...this.jobs.values()].some(
      (job) => job.connectionId === id && job.state.status === "pending"
    )
  }
  async start(connection, signal) {
    if (connection?.kind !== "subscription") throw new Error("请选择订阅连接。")
    if (this.hasConnection(connection.id))
      throw new Error("该连接正在授权，请先取消。")
    const saved = await this.service.save(connection, signal)
    if (saved.kind !== "subscription") throw new Error("请选择订阅连接。")
    signal?.throwIfAborted()
    const id = randomUUID()
    const controller = new AbortController()
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
    let runtime
    let deviceId
    try {
      runtime = await this.service.runtime(
        undefined,
        this.service.store.credentialStore({
          id,
          connectionId: saved.id,
          revision: saved.revision,
        })
      )
      signal?.throwIfAborted()
      deviceId = (await this.service.store.read()).deviceId
    } catch (error) {
      await this.service.store.update((data) => {
        if (data.authorizations[saved.providerId]?.id === id)
          delete data.authorizations[saved.providerId]
      })
      throw error
    }
    const job = {
      connectionId: saved.id,
      controller,
      state: { id, status: "pending", events: [], connection: saved },
      answer: null,
    }
    this.jobs.set(id, job)
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)
    timeout.unref()
    job.done = runtime
      .login(
        saved.providerId,
        "oauth",
        {
          signal: controller.signal,
          notify: (event) => {
            job.state.events = [...job.state.events, event].slice(-20)
          },
          prompt: (prompt) =>
            new Promise((resolve, reject) => {
              const promptId = randomUUID()
              const { signal, ...visible } = prompt
              const abort = () => {
                cleanup()
                reject(new DOMException("授权已取消", "AbortError"))
              }
              const cleanup = () => {
                signal?.removeEventListener("abort", abort)
                controller.signal.removeEventListener("abort", abort)
                delete job.state.prompt
                job.answer = null
              }
              job.state.prompt = { ...visible, id: promptId }
              job.answer = (value) => {
                cleanup()
                resolve(value)
              }
              signal?.addEventListener("abort", abort, { once: true })
              controller.signal.addEventListener("abort", abort, { once: true })
              if (signal?.aborted || controller.signal.aborted) abort()
            }),
        },
        { getDeviceId: () => deviceId }
      )
      .then(async () => {
        job.state.connection = (await this.service.list()).find(
          (item) => item.id === saved.id
        )
        job.state.status = "complete"
      })
      .catch(async (error) => {
        job.state.status = controller.signal.aborted ? "cancelled" : "error"
        job.state.error = controller.signal.aborted
          ? "授权已取消或超时。"
          : "订阅授权未完成，请重试。"
        if (
          error instanceof CredentialSynchronizationError &&
          error.operation === "login" &&
          !controller.signal.aborted
        ) {
          try {
            const current = (await this.service.list()).find(
              (item) => item.id === saved.id
            )
            if (current?.account?.loggedIn) {
              job.state.connection = current
              job.state.status = "complete"
              delete job.state.error
            }
          } catch {
            /* Preserve terminal error if the store cannot be read. */
          }
        }
      })
      .finally(async () => {
        await this.service.store
          .update((data) => {
            if (data.authorizations[saved.providerId]?.id === id)
              delete data.authorizations[saved.providerId]
          })
          .catch(() => {})
        clearTimeout(timeout)
        delete job.state.prompt
        job.answer = null
        const expiry = setTimeout(() => this.jobs.delete(id), 5 * 60 * 1000)
        expiry.unref()
      })
    return this.poll(id)
  }
  poll(id) {
    const job = this.jobs.get(id)
    if (!job) throw new Error("授权已结束，请重新开始。")
    return structuredClone(job.state)
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
    if (!job) return
    job.controller.abort()
    await job.done
  }
  close() {
    for (const job of this.jobs.values()) job.controller.abort()
  }
}
