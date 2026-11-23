import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

// Only imported by the desktop development host. stdout belongs to RPC.
export async function createDevResources() {
  const { createServer, createLogger } = await import("vite")
  const { default: config } = await import("./vite.config.ts")
  const root = fileURLToPath(new URL("./", import.meta.url))
  const logger = createLogger("warn")
  logger.warn = (message) =>
    process.stderr.write(`[workbench:vite] ${message}\n`)
  logger.error = logger.warn
  logger.info = () => {}
  const server = await createServer({
    ...config,
    root,
    configFile: false,
    customLogger: logger,
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false,
      fs: {
        strict: true,
        allow: [
          fileURLToPath(new URL("./src", import.meta.url)),
          fileURLToPath(new URL("../../../apps/workbench/src/workbench", import.meta.url)),
          fileURLToPath(new URL("../../../apps/workbench/src/ui", import.meta.url)),
          fileURLToPath(new URL("../../../apps/workbench/src/app/globals.css", import.meta.url)),
          fileURLToPath(new URL("../../../apps/workbench/node_modules", import.meta.url)),
          fileURLToPath(new URL("./node_modules", import.meta.url)),
          fileURLToPath(new URL("../../../node_modules", import.meta.url)),
        ],
      },
    },
  })
  return {
    async html() {
      return server.transformIndexHtml(
        "/",
        await readFile(new URL("./index.html", import.meta.url), "utf8")
      )
    },
    serve(req, res) {
      return new Promise((resolve, reject) => {
        const finish = () => {
          cleanup()
          resolve(true)
        }
        const cleanup = () => {
          res.off("finish", finish)
          res.off("close", finish)
        }
        res.once("finish", finish)
        res.once("close", finish)
        server.middlewares(req, res, (error) => {
          cleanup()
          if (error) reject(error)
          else resolve(false)
        })
      })
    },
    close: () => server.close(),
  }
}
