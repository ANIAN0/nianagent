import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

/** PDF.js needs its own shipped CMaps, fonts and decoder WASM in both hosts. */
export function pdfAssetsPlugin(): Plugin {
  const root = dirname(
    fileURLToPath(import.meta.resolve("pdfjs-dist/package.json"))
  )
  const assets = new Map<string, string>()
  const collect = async () => {
    for (const directory of ["cmaps", "standard_fonts", "wasm"])
      for (const entry of await readdir(join(root, directory), {
        withFileTypes: true,
      }))
        if (entry.isFile())
          assets.set(
            `pdfjs/${directory}/${entry.name}`,
            join(root, directory, entry.name)
          )
  }
  return {
    name: "moon-pdf-assets",
    async buildStart() {
      await collect()
    },
    async generateBundle() {
      for (const [fileName, path] of assets)
        this.emitFile({ type: "asset", fileName, source: await readFile(path) })
    },
    async configureServer(server) {
      await collect()
      server.middlewares.use(async (request, response, next) => {
        const name = request.url?.split("?")[0]?.replace(/^\//, "")
        const path = name ? assets.get(name) : undefined
        if (!path || !["GET", "HEAD"].includes(request.method || ""))
          return next()
        try {
          const bytes = await readFile(path)
          response.setHeader(
            "Content-Type",
            path.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream"
          )
          response.setHeader("Content-Length", bytes.length)
          response.end(request.method === "HEAD" ? undefined : bytes)
        } catch {
          response.statusCode = 404
          response.end()
        }
      })
    },
  }
}
