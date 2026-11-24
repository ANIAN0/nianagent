import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

// 旧嵌入宿主的 Vite 壳层，编辑和阅读组件由 Next 工作台提供。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(
        new URL("../../../apps/workbench/src", import.meta.url)
      ),
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
