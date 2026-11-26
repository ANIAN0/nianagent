import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import lockfile from "proper-lockfile"
import { parse, stringify } from "smol-toml"
import { replaceJson, withAcquiredLock } from "../../atomic-file.mjs"
import { readLocal, targets } from "./inspect.mjs"

function entryFor(client, definition) {
  const { envRefs = {}, headerRefs = {} } = definition
  const variables = Object.fromEntries(
    Object.entries(definition.url ? headerRefs : envRefs).map(
      ([key, value]) => [key, "$" + "{" + value + "}"]
    )
  )
  const hasRefs = Object.keys(variables).length > 0
  if (hasRefs && client === "Antigravity")
    throw new Error("当前 Antigravity 适配器无法确认凭据引用语法。")
  if (definition.url) {
    if (client === "Antigravity") return { serverUrl: definition.url }
    const headers = hasRefs
      ? client === "Codex"
        ? { env_http_headers: headerRefs }
        : { headers: variables }
      : {}
    return {
      ...(client === "Claude Code" ? { type: "http" } : {}),
      url: definition.url,
      ...headers,
    }
  }
  let env = {}
  if (hasRefs) {
    if (client === "Codex") {
      if (Object.entries(envRefs).some(([key, value]) => key !== value))
        throw new Error("Codex 的 env_vars 要求使用同名环境变量。")
      env = { env_vars: Object.keys(envRefs) }
    } else env = { env: variables }
  }
  return {
    ...(client === "Claude Code" ? { type: "stdio" } : {}),
    command: definition.command,
    args: definition.args,
    ...env,
  }
}
// Keep header references inline so they belong to this server's TOML table.
function tomlAssignment(field, value) {
  if (field !== "env_http_headers")
    return stringify({ [field]: value }).trimEnd()
  const pairs = Object.entries(value).map(([key, ref]) =>
    stringify({ [key]: ref }).trimEnd()
  )
  return field + " = { " + pairs.join(", ") + " }"
}

function editFile(client, before, name, definition, update) {
  const toml = client === "Codex"
  const key = toml ? "mcp_servers" : "mcpServers"
  const bom = before?.startsWith("\uFEFF") ? "\uFEFF" : ""
  const raw = before?.slice(bom.length) ?? ""
  let doc
  try {
    doc = before === null ? {} : toml ? parse(raw) : JSON.parse(raw)
  } catch {
    throw new Error("配置文件语法无效，无法预览写入。")
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    throw new Error("配置文件结构无效。")
  if (doc[key] === undefined) doc[key] = {}
  const entries = doc[key]
  if (!entries || typeof entries !== "object" || Array.isArray(entries))
    throw new Error("服务列表不是对象。")
  const exists = Object.hasOwn(entries, name)
  if (update && !exists) throw new Error("待更新的服务已移除。")
  if (definition && exists && !update)
    throw new Error("目标名称已存在，请选择其他名称或先移除原项。")
  if (!definition && !exists) throw new Error("目标服务已移除。")
  const previous = entries[name]
  const replacement = definition && entryFor(client, definition)
  let referenceField
  if (definition) {
    if (
      update &&
      (Boolean(entries[name]?.command) !== Boolean(definition.command) ||
        (entries[name]?.type &&
          !["http", "stdio", "streamable-http"].includes(entries[name].type)))
    )
      throw new Error("无法保留原传输的客户端专属设置，请新建条目。")
    entries[name] = update ? { ...previous, ...replacement } : replacement
    if (update && client !== "Antigravity") {
      referenceField = definition.url
        ? toml
          ? "env_http_headers"
          : "headers"
        : toml
          ? "env_vars"
          : "env"
      if (!Object.hasOwn(replacement, referenceField))
        delete entries[name][referenceField]
      if (!toml && previous[referenceField]) {
        // Literal client settings share a map with the references managed by Moon.
        const literals = Object.entries(previous[referenceField]).filter(
          ([, value]) =>
            typeof value !== "string" ||
            !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)
        )
        if (literals.length)
          entries[name][referenceField] = {
            ...Object.fromEntries(literals),
            ...replacement[referenceField],
          }
      }
    }
  } else delete entries[name]
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"
  if (!toml)
    return (
      bom +
      JSON.stringify(doc, null, raw.match(/\n([ \t]+)"/)?.[1] ?? 2).replaceAll(
        "\n",
        eol
      ) +
      (before === null || raw.endsWith("\n") ? eol : "")
    )
  let next
  if (definition && !update)
    next =
      raw +
      eol +
      "[mcp_servers." +
      name +
      "]" +
      eol +
      Object.entries(entries[name])
        .map(([field, value]) => tomlAssignment(field, value))
        .join(eol) +
      eol
  else {
    // Only remove a plainly delimited table. Check semantic equality after editing.
    const lines = raw.split(/(?<=\n)/u)
    const header = "[mcp_servers." + name + "]"
    const start = lines.findIndex((line) => line.trim() === header)
    if (start < 0)
      throw new Error("此 TOML 表使用内联或复杂语法，请在客户端文件中编辑。")
    let end = start + 1
    while (end < lines.length && !/^\s*\[/u.test(lines[end])) end++
    if (update) {
      const block = lines.slice(start + 1, end)
      const fields = new Set([...Object.keys(replacement), referenceField])
      for (const field of fields) {
        const value = entries[name][field]
        if (isDeepStrictEqual(value, previous[field])) continue
        // A client may serialize HTTP headers as a subtable instead of an inline map.
        if (field === "env_http_headers") {
          const sub = lines.findIndex(
            (line) => line.trim() === `[mcp_servers.${name}.${field}]`
          )
          if (sub >= end) {
            let tail = sub + 1
            while (tail < lines.length && !/^\s*\[/u.test(lines[tail])) tail++
            const body = lines.slice(sub + 1, tail)
            if (body.some((line) => line.includes("#") && !/^\s*#/u.test(line)))
              throw new Error("字段含行内注释，无法无损修改。")
            lines.splice(
              sub,
              tail - sub,
              ...body.filter((line) => /^\s*(#|$)/u.test(line))
            )
          }
        }
        const index = block.findIndex(
          (line) =>
            line.trimStart().startsWith(field + " ") ||
            line.trimStart().startsWith(field + "=")
        )
        const line =
          value === undefined ? "" : tomlAssignment(field, value) + eol
        if (index < 0) {
          if (line && block.length && !block.at(-1).endsWith("\n"))
            block.push(eol)
          block.push(line)
        } else {
          let last = index
          if (
            field === "env_vars" &&
            !block[index].split("#")[0].includes("]")
          ) {
            while (
              last + 1 < block.length &&
              !block[last].split("#")[0].includes("]")
            )
              last++
          }
          const replaced = block.slice(index, last + 1)
          if (
            replaced.some((part) => part.includes("#") && !/^\s*#/u.test(part))
          )
            throw new Error("字段含行内注释，无法无损修改。")
          block.splice(
            index,
            replaced.length,
            ...replaced.filter((part) => /^\s*#/u.test(part)),
            line
          )
        }
      }
      next = [...lines.slice(0, start + 1), ...block, ...lines.slice(end)].join(
        ""
      )
    } else
      next = [
        ...lines.slice(0, start),
        ...lines.slice(start, end).filter((line) => /^\s*(#|$)/u.test(line)),
        ...lines.slice(end),
      ].join("")
  }
  if (
    !isDeepStrictEqual(
      JSON.parse(JSON.stringify(parse(next))),
      JSON.parse(JSON.stringify(doc))
    )
  )
    throw new Error("无法保留 TOML 的其他设置。")
  return bom + next
}

async function folder(root, relative, create) {
  const parent = dirname(join(root, relative))
  if (parent !== root) {
    try {
      if (create) await mkdir(parent)
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    }
    try {
      if (
        (await lstat(parent)).isSymbolicLink() ||
        (await realpath(parent)) !== parent
      )
        throw new Error("配置目录指向项目外部。")
    } catch (error) {
      if (error.code !== "ENOENT" || create) throw error
    }
  }
}

export async function planMcp(
  root,
  client,
  entryName,
  definition,
  update = false
) {
  if (
    !Object.hasOwn(targets, client) ||
    !/^[a-zA-Z0-9_-]+$/.test(entryName) ||
    ["__proto__", "constructor", "prototype"].includes(entryName)
  )
    throw new Error("客户端或服务名无效。")
  const file = targets[client]
  await folder(root, file, false)
  const before = await readLocal(root, file)
  return {
    file,
    before,
    after: editFile(client, before, entryName, definition, update),
  }
}

export async function applyMcp(operation, stateFile, signal) {
  const { root } = operation
  for (const item of operation.files) {
    if (item.outcome === "written") continue
    signal?.throwIfAborted()
    try {
      const rootInfo = await lstat(root, { bigint: true })
      if (
        (await realpath(root)) !== root ||
        String(rootInfo.ino) !== operation.ino ||
        String(rootInfo.dev) !== operation.dev
      )
        throw new Error("项目目录已变化。")
      await folder(root, item.file, true)
      const file = join(root, item.file)
      const unlock = await lockfile.lock(file, { realpath: false, retries: 5 })
      await withAcquiredLock(unlock, async (committed) => {
        const current = await readLocal(root, item.file)
        if (current === item.after && item.started) {
          item.outcome = "written"
          return
        }
        if (current !== item.before)
          throw new Error("文件在预览后已变化，请重新预览。")
        item.started = true
        await replaceJson(stateFile, operation)
        const temporary = join(dirname(file), ".moon-" + randomUUID() + ".tmp")
        const mode = current === null ? 0o600 : (await lstat(file)).mode
        const handle = await open(temporary, "wx", mode)
        try {
          try {
            await handle.writeFile(item.after)
            await handle.chmod(mode)
          } finally {
            await handle.close()
          }
          await folder(root, item.file, false)
          if ((await readLocal(root, item.file)) !== current)
            throw new Error("文件在写入前已变化。")
          signal?.throwIfAborted()
          if (current === null) await link(temporary, file)
          else await rename(temporary, file)
          committed()
          if ((await readLocal(root, item.file)) !== item.after)
            throw new Error("写入结果待核对。")
          item.outcome = "written"
        } finally {
          await rm(temporary, { force: true })
        }
      })
    } catch (error) {
      item.outcome = "failed"
      item.reason = error.message
    }
    if (item.outcome === "written") {
      delete item.before
      delete item.after
      delete item.reason
    }
    await replaceJson(stateFile, operation)
  }
  return summarizeMcp(operation)
}

export function summarizeMcp(operation) {
  const done = operation.files.every((item) => item.outcome === "written")
  return {
    outcome: done ? "written" : "partialFailure",
    reason: operation.files
      .map(
        (item) =>
          item.file +
          " · " +
          (item.outcome === "written" ? "已写入" : (item.reason ?? "待核对"))
      )
      .join("\n"),
  }
}

export const readPreview = async (file) =>
  JSON.parse(await readFile(file, "utf8"))
