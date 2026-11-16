// @ts-check
// MCP 专属凭据与稳定 actor 登记表（最小身份契约的存储 owner，见 .dev/moon-workbench/技术方案.md）。
// actor 代表作者身份，轮换只换 credential；撤销记录保留并按上限归档，不静默删除或重置。
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { replaceJson } from "../../atomic-file.mjs"

const REGISTRY_FILE = "credentials.json"
const ARCHIVE_FILE = "credentials-archive.json"
export const LEGACY_ACTOR_ID = "legacy-shared"
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_VALID_CREDENTIALS = 32
export const MAX_REVOKED_RETAINED = 128
const NAME_PATTERN = /^[\p{L}\p{N}_. -]{1,64}$/u

const newToken = () => randomBytes(32).toString("base64url")
const now = () => new Date().toISOString()

const isRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value)

/** 逐字段校验登记表；坏文件抛错并保留原文件，不自动重置为可写空表。 */
const assertRegistry = (value) => {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.revision) ||
    !Array.isArray(value.actors) ||
    !Array.isArray(value.credentials)
  )
    throw new Error("MCP 凭据登记表无效，原文件已保留，请修复后重启。")
  for (const actor of value.actors) {
    if (
      !isRecord(actor) ||
      typeof actor.actorId !== "string" ||
      !ID_PATTERN.test(actor.actorId) ||
      typeof actor.displayName !== "string" ||
      !NAME_PATTERN.test(actor.displayName) ||
      !["agent", "legacy"].includes(actor.kind) ||
      typeof actor.createdAt !== "string"
    )
      throw new Error("MCP 凭据登记表 actor 字段无效，原文件已保留。")
  }
  for (const credential of value.credentials) {
    if (
      !isRecord(credential) ||
      typeof credential.credentialId !== "string" ||
      !ID_PATTERN.test(credential.credentialId) ||
      typeof credential.actorId !== "string" ||
      !ID_PATTERN.test(credential.actorId) ||
      typeof credential.token !== "string" ||
      !TOKEN_PATTERN.test(credential.token) ||
      typeof credential.createdAt !== "string" ||
      (credential.revokedAt !== null &&
        typeof credential.revokedAt !== "string")
    )
      throw new Error("MCP 凭据登记表 credential 字段无效，原文件已保留。")
  }
  const actorIds = new Set(value.actors.map((actor) => actor.actorId))
  if (value.credentials.some((credential) => !actorIds.has(credential.actorId)))
    throw new Error("MCP 凭据登记表存在无归属凭据，原文件已保留。")
}

/** 读取登记表；文件存在但内容无效（含 null）一律报错保留原文件，绝不重置为可写空表。 */
export async function loadRegistry(directory) {
  const file = join(directory, REGISTRY_FILE)
  let text = null
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error("MCP 凭据登记表无法读取，原文件已保留。", {
        cause: error,
      })
  }
  if (text !== null) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error("MCP 凭据登记表无法解析，原文件已保留。", {
        cause: error,
      })
    }
    assertRegistry(parsed)
    await assertArchiveFile(directory)
    return parsed
  }
  const registry = { revision: 0, actors: [], credentials: [] }
  try {
    const legacy = JSON.parse(
      await readFile(join(directory, "token.json"), "utf8")
    )
    if (isRecord(legacy) && typeof legacy.token === "string") {
      if (!TOKEN_PATTERN.test(legacy.token))
        throw new Error("旧 MCP token 文件无效，请保留原文件并修复。")
      registry.actors.push({
        actorId: LEGACY_ACTOR_ID,
        displayName: "旧共享凭据",
        kind: "legacy",
        createdAt: now(),
      })
      registry.credentials.push({
        credentialId: randomUUID(),
        actorId: LEGACY_ACTOR_ID,
        token: legacy.token,
        createdAt: now(),
        revokedAt: null,
      })
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  await replaceJson(file, registry)
  return registry
}

// Windows 对刚替换完成的文件做瞬时 EPERM/EBUSY 锁定（杀软/索引器）；有界重试属于正确性机制，最终仍明确失败。
const persistWithRetry = async (file, value) => {
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await replaceJson(file, value)
      return
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  throw lastError
}

const persist = (directory, registry) =>
  persistWithRetry(join(directory, REGISTRY_FILE), registry)

/** 归档文件只读校验：存在即必须结构有效（坏数据早失败，不等待归档触发时才发现）。 */
const assertArchiveFile = async (directory) => {
  let text
  try {
    text = await readFile(join(directory, ARCHIVE_FILE), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return
    throw new Error("MCP 凭据归档文件无法读取，原文件已保留。", {
      cause: error,
    })
  }
  let existing
  try {
    existing = JSON.parse(text)
  } catch (error) {
    throw new Error("MCP 凭据归档文件无法解析，原文件已保留。", {
      cause: error,
    })
  }
  if (!isRecord(existing) || !Array.isArray(existing.archived))
    throw new Error("MCP 凭据归档文件结构无效，原文件已保留。")
}

/** 撤销记录超过保留上限时移入归档文件（原样留存，不删除）；只作用于传入副本，返回是否发生归档。 */
const archiveIfNeeded = async (directory, registry) => {
  const revoked = registry.credentials
    .filter((credential) => credential.revokedAt)
    .sort((left, right) => (left.revokedAt < right.revokedAt ? -1 : 1))
  if (revoked.length <= MAX_REVOKED_RETAINED) return false
  const moving = revoked.slice(0, revoked.length - MAX_REVOKED_RETAINED)
  const movingIds = new Set(moving.map((credential) => credential.credentialId))
  registry.credentials = registry.credentials.filter(
    (credential) => !movingIds.has(credential.credentialId)
  )
  const archiveFile = join(directory, ARCHIVE_FILE)
  const archived = await readArchiveForAppend(archiveFile)
  archived.push(...moving)
  await persistWithRetry(archiveFile, { archived })
  return true
}

/** 归档读取（归档触发时）：结构无效一律报错，不覆盖原文件。 */
const readArchiveForAppend = async (archiveFile) => {
  try {
    const existing = JSON.parse(await readFile(archiveFile, "utf8"))
    if (!isRecord(existing) || !Array.isArray(existing.archived))
      throw new Error("MCP 凭据归档文件结构无效，原文件已保留。")
    return existing.archived
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
}

/**
 * 变更登记表的唯一路径：在深拷贝上构建新状态，持久化成功后才换入共享内存；
 * 归档与登记表任一持久化失败都保持内存不变（Q09：不得先改内存再落盘）。
 */
const commitRegistry = async (directory, registry, mutate) => {
  const next = structuredClone(registry)
  mutate(next)
  await archiveIfNeeded(directory, next)
  await persist(directory, next)
  registry.actors = next.actors
  registry.credentials = next.credentials
  registry.revision = next.revision
}

const assertCanRegister = (registry) => {
  const valid = registry.credentials.filter(
    (credential) => !credential.revokedAt
  )
  if (valid.length >= MAX_VALID_CREDENTIALS)
    throw new Error(
      `有效凭据已达 ${MAX_VALID_CREDENTIALS} 条上限，请先撤销或轮换后再登记。`
    )
}

/** 登记新 Agent：生成稳定 actor 与初始凭据；token 只在本次响应返回。 */
export async function registerAgent(directory, registry, displayName) {
  if (typeof displayName !== "string" || !NAME_PATTERN.test(displayName))
    throw new Error("显示名需为 1–64 位可见字符。")
  assertCanRegister(registry)
  const actor = {
    actorId: randomUUID(),
    displayName,
    kind: "agent",
    createdAt: now(),
  }
  const credential = {
    credentialId: randomUUID(),
    actorId: actor.actorId,
    token: newToken(),
    createdAt: now(),
    revokedAt: null,
  }
  let issued
  await commitRegistry(directory, registry, (next) => {
    next.actors.push(actor)
    next.credentials.push(credential)
    next.revision += 1
    issued = { actor, credential, token: credential.token }
  })
  return issued
}

/**
 * 轮换：撤销指定 actor 的当前有效凭据并签发新凭据；actorId 不变，不迁移 session。
 * 替换有效凭据不增加净数量；已撤销 actor 重新签发则必须占用可用配额。
 */
export async function rotateActor(directory, registry, actorId) {
  const actor = registry.actors.find((item) => item.actorId === actorId)
  if (!actor) throw new Error("actor 不存在。")
  const credential = {
    credentialId: randomUUID(),
    actorId,
    token: newToken(),
    createdAt: now(),
    revokedAt: null,
  }
  let issued
  await commitRegistry(directory, registry, (next) => {
    for (const item of next.credentials) {
      if (item.actorId === actorId && !item.revokedAt) item.revokedAt = now()
    }
    assertCanRegister(next)
    next.credentials.push(credential)
    next.revision += 1
    issued = { actor, credential, token: credential.token }
  })
  return issued
}

/** 撤销凭据（幂等）；返回该凭据涉及且确有变化的 actorId 列表，供宿主关闭其 session。 */
export async function revokeCredential(directory, registry, credentialId) {
  const credential = registry.credentials.find(
    (item) => item.credentialId === credentialId
  )
  if (!credential) throw new Error("凭据不存在。")
  if (credential.revokedAt)
    return { changed: false, actorId: credential.actorId }
  await commitRegistry(directory, registry, (next) => {
    const target = next.credentials.find(
      (item) => item.credentialId === credentialId
    )
    if (target && !target.revokedAt) {
      target.revokedAt = now()
      next.revision += 1
    }
  })
  return { changed: true, actorId: credential.actorId }
}

const sameToken = (supplied, expected) => {
  const left = Buffer.from(typeof supplied === "string" ? supplied : "")
  const right = Buffer.from(expected)
  return (
    left.length > 0 &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  )
}

/** 恒时校验并解析身份；未命中返回 null。仅匹配未撤销凭据。 */
export const authenticate = (registry, header) => {
  const token =
    typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : ""
  let hit = null
  for (const credential of registry.credentials) {
    if (credential.revokedAt) continue
    if (sameToken(token, credential.token)) hit = credential
  }
  return hit ? { actorId: hit.actorId, credentialId: hit.credentialId } : null
}

/** 凭据数（含撤销）与有效凭据数的只读摘要；不包含 token。 */
export const summarize = (registry) => ({
  actors: registry.actors.length,
  credentials: registry.credentials.length,
  valid: registry.credentials.filter((credential) => !credential.revokedAt)
    .length,
})
