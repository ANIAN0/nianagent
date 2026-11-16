import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

// 工作台应用自有构建：dev 服务器用于壳层 UI 迭代（构建期 Tailwind + @ 别名）。
// 发行产物构建见 build.js：双入口分别构建并内联为 workbench.bundle.mjs。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // 壳层 dev 迭代需转发 API 到本机插件宿主；端口与工作台配置一致，可用环境变量覆盖。
  server: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.NOTES_WORKBENCH_PORT ?? 19830}`,
      },
    },
  },
})
