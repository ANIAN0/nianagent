// @ts-check
// 构建 notes-workbench 预览 bundle：preview/manifest.mjs 声明条目 → 生成虚拟入口 →
// vendor（react 世界，自包含 ESM）+ 条目代码（react 外链 vendor）→ preview.bundle.mjs。
// 产物入库（runtime 打包只收 .mjs）；中间产物在 .dev/，不入库。
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import react from "@vitejs/plugin-react"
import { build } from "vite"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "..")
const srcDir = resolve(here, "../.dev/notes-preview-src")
const distDir = resolve(here, "../.dev/notes-preview-dist")
const bundleFile = resolve(
  here,
  "../backend/plugins/notes-workbench/preview.bundle.mjs"
)

const { previewEntries } = await import(
  pathToFileURL(resolve(repo, "backend/plugins/notes-workbench/preview/manifest.mjs"))
)
if (!Array.isArray(previewEntries) || previewEntries.length === 0)
  throw new Error("预览清单为空：preview/manifest.mjs 需声明至少一个条目。")
for (const entry of previewEntries) {
  if (!entry.id || !entry.file || !entry.export)
    throw new Error(`预览条目缺少 id/file/export：${JSON.stringify(entry)}`)
}

await rm(srcDir, { recursive: true, force: true })
await rm(distDir, { recursive: true, force: true })
await mkdir(srcDir, { recursive: true })

// 条目入口：按清单具名导入并聚合为 { id: component }。
const entryFile = resolve(srcDir, "entries.mjs")
let entryCode = ""
for (const entry of previewEntries) {
  const importer = relative(srcDir, resolve(repo, entry.file)).replaceAll("\\", "/")
  entryCode += `import { ${entry.export} } from "./${importer}"\n`
}
entryCode += "\nexport const entries = {\n"
for (const entry of previewEntries)
  entryCode += `  ${JSON.stringify(entry.id)}: ${entry.export},\n`
entryCode += "}\n"
await writeFile(entryFile, entryCode)

// vendor 入口：合并 react、jsx 运行时与常用 react-dom 导出。
// rolldown 无法静态推导 `export * from` CJS 包的名字（会整体丢导出），
// 因此在构建期用 Node 枚举各包的真实导出名，生成显式具名再导出。
const reactNamespace = await import("react")
const reactDomNamespace = await import("react-dom")
const jsxNamespace = await import("react/jsx-runtime")
const clientNamespace = await import("react-dom/client")
const taken = new Set(["default"])
const vendorLines = ['import * as React from "react"']
const isIdentifier = (name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
const reexport = (namespace, label, prefer = []) => {
  const names = [...prefer, ...Object.keys(namespace)]
  for (const name of names) {
    if (name === "default" || !isIdentifier(name)) continue
    if (!(name in namespace) || taken.has(name)) continue
    taken.add(name)
    vendorLines.push(`export const ${name} = ${label}.${name}`)
  }
}
reexport(reactNamespace, "React")
reexport(jsxNamespace, "Jsx", ["jsx", "jsxs", "jsxDEV"])
reexport(reactDomNamespace, "ReactDom", ["createPortal", "flushSync"])
reexport(clientNamespace, "Client", ["createRoot", "hydrateRoot"])
// import 声明提升：上方 export const 引用的三个命名空间在此统一声明。
// default 兼容两类 CJS 互操作默认导入：import React from "react" 与
// import ReactDOM from "react-dom"——合并为携带全部能力的单一对象。
vendorLines.push(
  'import * as Jsx from "react/jsx-runtime"',
  'import * as ReactDom from "react-dom"',
  'import * as Client from "react-dom/client"',
  "export default { ...React, ...ReactDom, jsx: Jsx.jsx, jsxs: Jsx.jsxs, jsxDEV: Jsx.jsxDEV, createRoot: Client.createRoot, hydrateRoot: Client.hydrateRoot }",
)
const vendorFile = resolve(srcDir, "vendor.mjs")
await writeFile(vendorFile, vendorLines.join("\n") + "\n")

const sharedBuild = {
  // 独立构建：不加载项目 vite.config（其插件链与 build 选项会破坏 lib 产物）。
  configFile: false,
  root: repo,
  logLevel: "warn",
  publicDir: false,
  plugins: [react()],
  resolve: { alias: { "@": resolve(repo, "src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
}
const libBuild = async (entry, name, extra = {}) => {
  const target = resolve(distDir, name.replace(/\.esm\.js$/, ""))
  await build({
    ...sharedBuild,
    build: {
      outDir: target,
      emptyOutDir: true,
      target: "es2022",
      assetsInlineLimit: 0,
      lib: { entry, formats: ["es"], fileName: () => name },
      rollupOptions: {
        external: extra.external,
        output: { codeSplitting: false, ...extra.output },
      },
    },
  })
  return readFile(resolve(target, name), "utf8")
}

// vendor 自包含 react；条目与工作台 preview 入口把 react 外链到 /preview/vendor.mjs。
// react 是 CJS 包：export * 的名字无法静态推导，vendor 构建必须关闭 treeshake 保全导出。
const vendorCode = await libBuild(
  vendorFile,
  "vendor.esm.js",
  { treeshake: false }
)
const previewCode = await libBuild(entryFile, "entries.esm.js", {
  external: [/^react($|\/)/, /^react-dom($|\/)/],
  output: {
    paths: {
      react: "/preview/vendor.mjs",
      "react/jsx-runtime": "/preview/vendor.mjs",
      "react/jsx-dev-runtime": "/preview/vendor.mjs",
      "react-dom": "/preview/vendor.mjs",
      "react-dom/client": "/preview/vendor.mjs",
    },
  },
})
await mkdir(dirname(bundleFile), { recursive: true })
await writeFile(
  bundleFile,
  [
    "// 由 scripts/build-notes-preview.mjs 生成，请勿手改；改 preview/ 后重新构建。",
    "/** @type {string} */",
    `export const vendorCode = ${JSON.stringify(vendorCode)};`,
    "/** @type {string} */",
    `export const previewCode = ${JSON.stringify(previewCode)};`,
    "",
  ].join("\n")
)
console.log(
  `notes-preview bundle: ${((vendorCode.length + previewCode.length) / 1024).toFixed(
    0
  )} KiB，${previewEntries.length} 个条目 → ${bundleFile}`
)
