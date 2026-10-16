import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type ResolvedConfig } from "vite"
import { modelBackendPlugin } from "./backend/bridge.mjs"
import { uiCatalogPlugin } from "./scripts/ui-catalog-plugin.ts"
import { apiCatalogPlugin } from "./scripts/api-catalog-plugin.ts"
import { pdfAssetsPlugin } from "./scripts/pdf-assets-plugin.ts"
import { assertWebBase } from "./scripts/web-base.mjs"

/** Dev and both production graphs share the same configuration and fresh plugins. */
export function createMoonViteConfig() {
  return {
    base: assertWebBase(process.env.MOON_WEB_BASE || "/"),
    plugins: [
      {
        name: "moon-supported-web-base",
        configResolved: (config: ResolvedConfig) => { assertWebBase(config.base) },
      },
      react(),
      tailwindcss(),
      modelBackendPlugin(),
      uiCatalogPlugin(),
      apiCatalogPlugin(),
      pdfAssetsPlugin(),
    ],
    build: {
      rolldownOptions: {
        input: {
          app: resolve(import.meta.dirname, "index.html"),
          apiCatalog: resolve(import.meta.dirname, "api-catalog/index.html"),
          catalog: resolve(import.meta.dirname, "ui-catalog/index.html"),
          preview: resolve(import.meta.dirname, "ui-catalog/preview.html"),
        },
      },
    },
    server: {
      watch: {
        // Rust outputs and isolated task worktrees must not trigger app HMR.
        ignored: ["**/src-tauri/**", "**/.dev/**"],
      },
    },
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "./src"),
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(createMoonViteConfig)
