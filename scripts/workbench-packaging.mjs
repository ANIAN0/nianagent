import { spawnSync } from "node:child_process"
import { cp, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { workbenchAppPath } from "../backend/workbench-paths.mjs"
import { packagingEnvironment, projectRoot } from "./release-settings.mjs"

const app = resolve(projectRoot, workbenchAppPath)

function workbenchPnpm(args) {
  const result = spawnSync("pnpm", ["--filter", "@moon/workbench", ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: packagingEnvironment(),
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `工作台制备失败（pnpm ${args[0]}，状态 ${result.status}）。`
    )
}

export function buildWorkbench() {
  workbenchPnpm(["exec", "next", "build"])
}

export async function assembleWorkbench(destination) {
  const next = join(app, ".next")
  const compiled = join(next, "standalone", workbenchAppPath)
  const output = join(destination, workbenchAppPath)
  await mkdir(output, { recursive: true })
  // 只收录可启动的应用与静态资源。Next 的追踪结果也可能包含本机数据和源码。
  for (const file of ["server.js", "package.json", ".next"])
    await cp(join(compiled, file), join(output, file), { recursive: true })
  await cp(join(next, "static"), join(output, ".next/static"), {
    recursive: true,
  })
  const publicDir = join(app, "public")
  const publicEntry = await lstat(publicDir).catch((error) => {
    if (error.code === "ENOENT") return null
    throw error
  })
  if (publicEntry) {
    if (!publicEntry.isDirectory())
      throw new Error("工作台 public 必须是普通目录")
    await cp(publicDir, join(output, "public"), { recursive: true })
  }

  // Next 在 Windows 上可能生成绝对 junction，移动后失效，Tauri 也不会展开。
  // 用同一份锁文件部署平铺的生产依赖，保留 Node 的正常模块解析。
  const stagingParent = resolve(projectRoot, ".dev")
  await mkdir(stagingParent, { recursive: true })
  if ((await lstat(stagingParent)).isSymbolicLink())
    throw new Error("拒绝通过链接目录装配工作台依赖")
  const staging = await mkdtemp(join(stagingParent, "workbench-deploy-"))
  try {
    workbenchPnpm([
      "deploy",
      "--prod",
      "--ignore-scripts",
      "--config.node-linker=hoisted",
      relative(projectRoot, staging),
    ])
    await rename(join(staging, "node_modules"), join(output, "node_modules"))
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5 })
  }
}
