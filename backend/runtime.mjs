import { createServer } from "node:http"
import { randomUUID, createHash, timingSafeEqual } from "node:crypto"
import {
  readFile,
  writeFile,
  rename,
  unlink,
  mkdir,
  readdir,
} from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import lockfile from "proper-lockfile"
import { readJsonBody } from "./http-body.mjs"

export async function runtimeVersion() {
  const dir = dirname(fileURLToPath(import.meta.url))
  const hash = createHash("sha256")
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".mjs"))
    .sort()) {
    hash.update(name).update(await readFile(join(dir, name)))
  }
  return hash.digest("hex")
}
export async function startRuntime(file, dispatch, publicError) {
  const version = await runtimeVersion()
  await mkdir(dirname(file), { recursive: true })
  const release = await lockfile
    .lock(file, {
      realpath: false,
      lockfilePath: `${file}.lock`,
      retries: 0,
    })
    .catch(() => {
      throw new Error("模型服务已由另一个 Moon 窗口运行，请使用已有窗口。")
    })
  const token = randomUUID()
  const instance = randomUUID()
  const controllers = new Set()
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json")
    res.setHeader("cache-control", "no-store")
    const auth = Buffer.from(String(req.headers["x-moon-token"] ?? ""))
    const expected = Buffer.from(token)
    if (
      req.headers.origin ||
      auth.length !== expected.length ||
      !timingSafeEqual(auth, expected)
    ) {
      res.writeHead(403).end(JSON.stringify({ error: "模型服务访问被拒绝。" }))
      return
    }
    if (req.url === "/health" && req.method === "GET") {
      res.end(JSON.stringify({ instance, version }))
      return
    }
    if (req.method !== "POST" || !req.url?.startsWith("/api/models/")) {
      res.writeHead(404).end()
      return
    }
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      res.writeHead(415).end()
      return
    }
    const controller = new AbortController()
    controllers.add(controller)
    res.on("close", () => {
      if (!res.writableEnded) controller.abort()
    })
    try {
      const operation = req.url.slice("/api/models/".length).split("?")[0]
      const input = await readJsonBody(req, operation === "materialUpload" ? 16 * 1024 * 1024 : 1024 * 1024)
      const result = await dispatch(
        operation,
        input,
        controller.signal
      )
      if (!res.destroyed) res.end(JSON.stringify({ result }))
    } catch (error) {
      if (!res.destroyed)
        res.writeHead(400).end(JSON.stringify({ error: publicError(error) }))
    } finally {
      controllers.delete(controller)
    }
  })
  const temporary = `${file}.${instance}.tmp`
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const info = {
      instance,
      version,
      port: server.address().port,
      token,
      pid: process.pid,
    }
    await writeFile(temporary, JSON.stringify(info), { mode: 0o600 })
    await rename(temporary, file)
    return {
      info,
      async close() {
        for (const c of controllers) c.abort()
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        try {
          if (JSON.parse(await readFile(file, "utf8")).instance === instance)
            await unlink(file)
        } catch {
          /* Already removed. */
        }
        await release()
      },
    }
  } catch (error) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(() => resolve()))
    const cleanup = await Promise.allSettled([
      unlink(temporary).catch((cleanupError) => {
        if (cleanupError.code !== "ENOENT") throw cleanupError
      }),
      release(),
    ])
    const failures = cleanup.filter((result) => result.status === "rejected")
    if (failures.length) {
      throw new AggregateError(
        [error, ...failures.map((result) => result.reason)],
        "模型服务启动失败，临时资源清理失败。"
      )
    }
    throw error
  }
}
