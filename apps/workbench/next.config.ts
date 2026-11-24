import type { NextConfig } from "next"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const appDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(appDir, "../..")

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep the listener origin for the internal preview rewrite.
  skipProxyUrlNormalize: true,
  outputFileTracingRoot: repoRoot,
  outputFileTracingExcludes: {
    "/*": ["../../.dev/**/*", "../../src-tauri/runtime/**/*"],
  },
  serverExternalPackages: ["node:sqlite"],
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

// Each local listener needs its own Next dev lock and compiler cache.
export default function config(phase: string): NextConfig {
  if (phase !== "phase-development-server") return nextConfig
  const port = Number(
    process.env.PORT || process.env.MOON_WORKBENCH_PORT || 19830
  )
  return { ...nextConfig, distDir: `.dev/next/${port}` }
}
