// @ts-check
// 构建 notes-workbench 独立工作台：workbench/ → 内联单文件 HTML → workbench.bundle.mjs。
// 产物入库（runtime 打包只收 .mjs）；临时构建输出在 .dev/，不入库。
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { build } from "vite"
import { workbenchFingerprint } from "../backend/plugins/notes-workbench/fingerprint.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../backend/plugins/notes-workbench/workbench")
const outDir = resolve(here, "../.dev/notes-workbench-dist")
const bundleFile = resolve(
  here,
  "../backend/plugins/notes-workbench/workbench.bundle.mjs"
)

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

// 每个入口独立构建：产物必须内联为单文件，不能出现共享 chunk。
const buildDocument = async (name) => {
  const target = resolve(outDir, name)
  await rm(target, { recursive: true, force: true })
  await build({
    root,
    logLevel: "info",
    plugins: [react()],
    build: {
      outDir: target,
      emptyOutDir: true,
      target: "es2022",
      assetsInlineLimit: 0,
      rollupOptions: {
        input: resolve(root, `${name}.html`),
        output: { codeSplitting: false },
      },
    },
  })
  const html = await readFile(resolve(target, `${name}.html`), "utf8")
  const assets = {}
  for (const file of html.matchAll(/(?:src|href)="\.?\/?([^"]+\.(?:js|css))"/g)) {
    assets[file[1]] = await readFile(resolve(target, file[1]), "utf8")
  }
  const document = inline(html, assets)
  if (/<script[^>]*src=|<link[^>]*href=/.test(document))
    throw new Error(`仍有未内联的外部资源：${name}，请检查构建输出。`)
  return document
}
await rm(outDir, { recursive: true, force: true })
const document = await buildDocument("index")
const previewDocument = await buildDocument("preview")
await mkdir(dirname(bundleFile), { recursive: true })
await writeFile(
  bundleFile,
  [
    "// 由 scripts/build-notes-workbench.mjs 生成，请勿手改；改 workbench/ 后重新构建。",
    "/** @type {string} */",
    `export const workbenchHtml = ${JSON.stringify(document)};`,
    "/** @type {string} */",
    `export const previewHtml = ${JSON.stringify(previewDocument)};`,
    `export const sourceFingerprint = ${JSON.stringify(
      await workbenchFingerprint(root)
    )};`,
    "",
  ].join("\n")
)
console.log(
  `notes-workbench bundle: ${(
    (document.length + previewDocument.length) /
    1024
  ).toFixed(0)} KiB → ${bundleFile}`
)
