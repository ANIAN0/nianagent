import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { workbenchAppPath } from "../../backend/workbench-paths.mjs"
import { assembleWorkbench } from "../../scripts/workbench-packaging.mjs"

const app = dirname(fileURLToPath(import.meta.url))
const releases = join(app, ".releases")
await mkdir(releases, { recursive: true })
if ((await lstat(releases)).isSymbolicLink())
  throw new Error("拒绝通过链接目录制备工作台开发版本")
const release = await mkdtemp(join(releases, "rel-"))
const pending = join(release, "current.json")
try {
  await assembleWorkbench(release)
  await writeFile(
    pending,
    JSON.stringify({
      releaseId: relative(releases, release),
      entry: relative(app, join(release, workbenchAppPath, "server.js")),
      createdAt: new Date().toISOString(),
    })
  )
  await rename(pending, join(releases, "current.json"))
} catch (error) {
  await rm(release, { recursive: true, force: true, maxRetries: 5 })
  throw error
}

for (const entry of await readdir(releases, { withFileTypes: true })) {
  const previous = join(releases, entry.name)
  if (
    entry.isDirectory() &&
    entry.name.startsWith("rel-") &&
    previous !== release
  )
    await rm(previous, { recursive: true, force: true }).catch(() => {})
}
console.log(
  `Prepared Next.js standalone release: ${relative(releases, release)}`
)
