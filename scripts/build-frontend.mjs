import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { build, loadConfigFromFile } from "vite"
import { assertWebBase } from "./web-base.mjs"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const defaultManifest = ".vite/manifest.json"
const graphManifests = {
  app: ".vite/app-manifest.json",
}

/** Keep CLI flags used by the existing build command; internal manifests are always generated. */
export function parseBuildArguments(args) {
  const options = { manifest: defaultManifest }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") continue
    const [flag, inline] = args[index].split(/=(.*)/s)
    if (flag === "--manifest") {
      options.manifest =
        inline ||
        (args[index + 1] && !args[index + 1].startsWith("-")
          ? args[++index]
          : defaultManifest)
    } else if (flag === "--mode" || flag === "--base") {
      const value = inline ?? args[++index]
      if (!value || value.startsWith("-"))
        throw new Error(`${flag} requires a value`)
      options[flag.slice(2)] = value
    } else throw new Error(`Unsupported frontend build option: ${args[index]}`)
  }
  if (Object.values(graphManifests).includes(options.manifest))
    throw new Error("The combined manifest cannot replace a graph manifest")
  return options
}

/** Restrict all generated output and reject links in its path. */
export function outputPath(outDir, fileName) {
  const boundary = resolve(outDir)
  const target = resolve(boundary, fileName)
  if (!target.startsWith(boundary + sep))
    throw new Error(`Build output escapes dist: ${fileName}`)
  for (let directory = dirname(target); ; directory = dirname(directory)) {
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink())
      throw new Error(`Build output contains a linked directory: ${directory}`)
    if (directory === boundary) break
  }
  return target
}

/** Let Vite transpile its TypeScript config, including on Node without native TS support. */
export async function loadMoonViteConfig(options = {}) {
  const result = await loadConfigFromFile(
    {
      command: options.command ?? "build",
      mode: options.mode ?? "production",
      isSsrBuild: false,
      isPreview: options.isPreview ?? false,
    },
    resolve(projectRoot, "vite.config.ts"),
    projectRoot
  )
  if (!result)
    throw new Error("The Moon Vite configuration could not be loaded")
  return result.config
}

export async function createBuildGraphs(options = {}) {
  const appConfig = await loadMoonViteConfig(options)
  const allEntries = appConfig.build.rolldownOptions.input
  const graphs = [
    [
      "app",
      { app: allEntries.app, pluginDevelopment: allEntries.pluginDevelopment },
    ],
  ]
  return graphs.map(([name, input], index) => {
    const config = appConfig
    return {
      name,
      manifest: graphManifests[name],
      config: {
        ...config,
        configFile: false,
        root: projectRoot,
        build: {
          ...config.build,
          outDir: "dist",
          assetsDir: "assets",
          manifest: graphManifests[name],
          emptyOutDir: index === 0,
          copyPublicDir: index === 0,
          rolldownOptions: { ...config.build.rolldownOptions, input },
        },
      },
    }
  })
}

/** Ship the app and read-only plugin guide; inspection and debugging tools remain dev-only. */
export async function buildFrontend(options = {}) {
  if (options.base !== undefined) assertWebBase(options.base)
  const outDir = resolve(projectRoot, "dist")
  if (existsSync(outDir) && lstatSync(outDir).isSymbolicLink())
    throw new Error("Refusing to build into a linked dist directory")
  const manifestName = options.manifest ?? defaultManifest
  if (Object.values(graphManifests).includes(manifestName))
    throw new Error("The combined manifest cannot replace a graph manifest")
  outputPath(outDir, manifestName)
  const manifests = {}
  for (const graph of await createBuildGraphs(options)) {
    await build({
      ...graph.config,
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.base ? { base: options.base } : {}),
    })
    manifests[graph.name] = JSON.parse(
      readFileSync(outputPath(outDir, graph.manifest), "utf8")
    )
  }
  const combined = manifests.app
  const destination = outputPath(outDir, manifestName)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, JSON.stringify(combined, null, 2) + "\n")
  return combined
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildFrontend(parseBuildArguments(process.argv.slice(2)))
