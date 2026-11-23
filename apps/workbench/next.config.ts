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

export default nextConfig
