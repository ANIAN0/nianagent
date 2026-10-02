import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        catalog: resolve(import.meta.dirname, "ui-catalog/index.html"),
        preview: resolve(import.meta.dirname, "ui-catalog/preview.html"),
      },
    },
  },
  server: {
    watch: {
      // Rust build outputs can be locked while Cargo is compiling on Windows.
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
