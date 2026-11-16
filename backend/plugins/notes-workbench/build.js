// @ts-check
// 工作台应用产物构建（本包自有管线）：唯一入口 index（工作台壳），
// 构建为内联单文件 HTML 写入 workbench.bundle.mjs，由 host.mjs 原样托管；
// runtime 打包白名单（plugins/**/*.mjs）零改动。旧 preview 双入口已随 catalog 面退役。
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { build } from "vite"

const root = dirname(fileURLToPath(import.meta.url))
const repo = resolve(root, "../../..")
const outDir = resolve(repo, ".dev/notes-workbench-dist")
const bundleFile = resolve(root, "workbench.bundle.mjs")

const inline = (html, assets) =>
  html
    .replace(
      /<script type="module"[^>]*src="\.?\/?([^"]+\.js)"[^>]*><\/script>/g,
      (_, file) =>
        `<script type="module">${assets[file] ?? missing(file)}</script>`
    )
    .replace(
      /<link rel="stylesheet"[^>]*href="\.?\/?([^"]+\.css)"[^>]*>/g,
      (_, file) => `<style>${assets[file] ?? missing(file)}</style>`
    )
const missing = (file) => {
  throw new Error(`构建产物缺少资源：${file}`)
}

const buildDocument = async () => {
  const target = resolve(outDir, "index")
  await rm(target, { recursive: true, force: true })
  await build({
    // 独立构建：不加载 Moon 的 vite.config，应用管线只包含 react 与构建期 Tailwind。
    configFile: false,
    root,
    logLevel: "info",
    plugins: [react(), tailwindcss()],
    build: {
      outDir: target,
      emptyOutDir: true,
      target: "es2022",
      assetsInlineLimit: 0,
      rollupOptions: {
        input: resolve(root, "index.html"),
        output: { codeSplitting: false },
      },
    },
  })
  const html = await readFile(resolve(target, "index.html"), "utf8")
  const assets = {}
  for (const file of html.matchAll(
    /(?:src|href)="\.?\/?([^"]+\.(?:js|css))"/g
  )) {
    assets[file[1]] = await readFile(resolve(target, file[1]), "utf8")
  }
  const document = inline(html, assets)
  if (/<script[^>]*src=|<link[^>]*href=/.test(document))
    throw new Error("仍有未内联的外部资源，请检查构建输出。")
  return document
}

await rm(outDir, { recursive: true, force: true })
const document = await buildDocument()
await mkdir(dirname(bundleFile), { recursive: true })
await writeFile(
  bundleFile,
  [
    "// 由 notes-workbench 应用构建管线（build.js）生成，请勿手改；改 src/ 后重新构建。",
    "/** @type {string} */",
    `export const workbenchHtml = ${JSON.stringify(document)};`,
    "",
  ].join("\n")
)
console.log(
  `notes-workbench bundle: ${(document.length / 1024).toFixed(0)} KiB → ${bundleFile}`
)
