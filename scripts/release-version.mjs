import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { projectRoot, productVersion } from "./release-settings.mjs"

const arguments_ = process.argv.slice(2)
const check = arguments_.includes("--check")
const tagIndex = arguments_.indexOf("--tag")
if (
  arguments_.some(
    (value, index) =>
      value !== "--check" &&
      value !== "--tag" &&
      !(tagIndex >= 0 && index === tagIndex + 1)
  )
)
  throw new Error("用法：release-version.mjs [--check] [--tag vX.Y.Z]")
const version = await productVersion()
if (tagIndex >= 0 && arguments_[tagIndex + 1] !== `v${version}`)
  throw new Error(`发行 tag 必须与产品版本一致：v${version}`)

// 产品版本只有一处人工维护；同步命令不递增版本，CI 只检查。
for (const file of ["package.json", "backend/package.json"]) {
  const path = resolve(projectRoot, file)
  const contents = JSON.parse(await readFile(path, "utf8"))
  if (check && contents.version !== version)
    throw new Error(`${file} 版本未同步，请运行 pnpm release:version`)
  if (!check && contents.version !== version) {
    contents.version = version
    await writeFile(path, `${JSON.stringify(contents, null, 2)}\n`)
  }
}
const cargoPath = resolve(projectRoot, "src-tauri/Cargo.toml")
const cargo = await readFile(cargoPath, "utf8")
const packageVersion = /(\[package\][\s\S]*?\nversion = ")([^"]+)(")/
if (!packageVersion.test(cargo)) throw new Error("Cargo 产品版本字段不存在")
if (check && cargo.match(packageVersion)[2] !== version)
  throw new Error("Cargo 版本未同步，请运行 pnpm release:version")
if (!check)
  await writeFile(cargoPath, cargo.replace(packageVersion, `$1${version}$3`))
if (!check) {
  const update = spawnSync(
    "cargo",
    ["update", "--workspace", "--manifest-path", cargoPath],
    { cwd: projectRoot, stdio: "inherit" }
  )
  if (update.status !== 0) throw new Error("Cargo 产品版本锁定更新失败")
}
const lock = await readFile(
  resolve(projectRoot, "src-tauri/Cargo.lock"),
  "utf8"
)
if (
  !lock
    .replaceAll("\r\n", "\n")
    .includes(`name = "app"\nversion = "${version}"`)
)
  throw new Error("Cargo.lock 产品版本未同步，请运行 pnpm release:version")
console.info(`产品版本 ${version} ${check ? "核对通过" : "已同步"}`)
