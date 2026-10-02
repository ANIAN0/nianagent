import { assertSchema, schemas } from "./schema.mjs"
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"

// One atomic document owns connection metadata and Pi CredentialStore values.
export class ModelStore {
  constructor(directory) {
    this.directory = directory
    this.file = join(directory, "models.json")
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.read()
  }
  async read() {
    let data
    try {
      data = JSON.parse(await readFile(this.file, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT")
        return {
          version: 1,
          deviceId: randomUUID(),
          connections: [],
          credentials: {},
          authorizations: {},
        }
      if (error instanceof SyntaxError)
        throw new Error("模型配置文件损坏：不是有效 JSON；原文件未覆盖。", {
          cause: error,
        })
      if (["EACCES", "EPERM"].includes(error.code))
        throw new Error(
          "无权读取模型配置文件，请检查文件权限；原文件未覆盖。",
          { cause: error }
        )
      throw new Error("模型配置文件读取失败；原文件未覆盖。", { cause: error })
    }
    if (
      !data ||
      typeof data !== "object" ||
      data.version !== 1 ||
      typeof data.deviceId !== "string" ||
      !Array.isArray(data.connections) ||
      !data.credentials ||
      typeof data.credentials !== "object" ||
      Array.isArray(data.credentials)
    )
      throw new Error("不支持或损坏的模型配置；原文件未覆盖。")
    try {
      const ids = new Set()
      for (const connection of data.connections) {
        assertSchema(schemas.ModelConnection, {
          ...connection,
          apiKey: "",
          keySaved: false,
        })
        if (!connection.revision || ids.has(connection.id)) throw new Error()
        ids.add(connection.id)
      }
      for (const credential of Object.values(data.credentials)) {
        if (
          !credential ||
          typeof credential !== "object" ||
          Array.isArray(credential)
        )
          throw new Error()
        if (credential.type === "api_key") {
          if (typeof credential.key !== "string") throw new Error()
        } else if (credential.type === "oauth") {
          if (
            typeof credential.access !== "string" ||
            typeof credential.refresh !== "string" ||
            !Number.isFinite(credential.expires)
          )
            throw new Error()
        } else throw new Error()
      }
      if (data.authorizations !== undefined) {
        if (
          !data.authorizations ||
          typeof data.authorizations !== "object" ||
          Array.isArray(data.authorizations)
        )
          throw new Error()
        for (const lease of Object.values(data.authorizations)) {
          if (
            !lease ||
            typeof lease.id !== "string" ||
            typeof lease.connectionId !== "string" ||
            !Number.isFinite(lease.expiresAt)
          )
            throw new Error()
        }
      }
    } catch {
      throw new Error("模型配置文件结构损坏；原文件未覆盖。")
    }
    data.authorizations ??= {}
    return data
  }
  async update(change, signal) {
    const unlock = await lockfile.lock(this.directory, {
      realpath: false,
      retries: { retries: 30, minTimeout: 30, maxTimeout: 300 },
    })
    const temporary = join(this.directory, `.models-${randomUUID()}.tmp`)
    try {
      signal?.throwIfAborted()
      const data = await this.read()
      const result = await change(data)
      signal?.throwIfAborted()
      await writeFile(temporary, JSON.stringify(data, null, 2), {
        mode: 0o600,
        flag: "wx",
      })
      signal?.throwIfAborted()
      await rename(temporary, this.file)
      return result
    } finally {
      await rm(temporary, { force: true })
      await unlock()
    }
  }
  credentialStore(guard) {
    return {
      read: async (id, options) => {
        options?.signal?.throwIfAborted()
        return (await this.read()).credentials[id]
      },
      list: async () =>
        Object.entries((await this.read()).credentials).map(
          ([providerId, credential]) => ({ providerId, type: credential.type })
        ),
      modify: (id, fn, options) =>
        this.update(async (data) => {
          options?.signal?.throwIfAborted()
          if (
            guard &&
            (!data.connections.some(
              (item) =>
                item.id === guard.connectionId &&
                item.revision === guard.revision &&
                item.providerId === id
            ) ||
              data.authorizations[id]?.id !== guard.id ||
              data.authorizations[id]?.expiresAt < Date.now())
          )
            throw new Error("授权连接已变更，请重新开始。 ")
          const credential = await fn(data.credentials[id])
          options?.signal?.throwIfAborted()
          if (guard && data.authorizations[id]?.expiresAt < Date.now())
            throw new Error("授权已过期，请重新开始。")
          if (credential !== undefined) data.credentials[id] = credential
          return data.credentials[id]
        }, options?.signal),
      delete: (id, options) =>
        this.update((data) => {
          options?.signal?.throwIfAborted()
          delete data.credentials[id]
        }, options?.signal),
    }
  }
}
export function memoryCredentials(initial = {}) {
  const data = structuredClone(initial)
  return {
    data,
    read: async (id) => data[id],
    list: async () =>
      Object.entries(data).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      })),
    modify: async (id, fn) => {
      const value = await fn(data[id])
      if (value !== undefined) data[id] = value
      return data[id]
    },
    delete: async (id) => {
      delete data[id]
    },
  }
}
