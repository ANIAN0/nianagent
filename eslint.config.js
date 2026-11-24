import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"
import path from "node:path"
import moonUi from "./scripts/eslint-ui-consistency.mjs"
import { moonBoundary } from "./scripts/eslint-module-boundaries.mjs"

export default defineConfig([
  globalIgnores([
    "dist",
    "src-tauri/runtime",
    "src-tauri/target",
    ".dev",
    "apps/workbench/.next/",
    "apps/workbench/.dev/next/",
    "apps/workbench/.releases/",
  ]),
  {
    files: [
      "backend/**/*.mjs",
      "scripts/**/*.mjs",
      "apps/workbench/src/server/**/*.mjs",
    ],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // G15 领域依赖边界（运行时导入；类型依赖由 tseslint 单独报告）：
  // ① 业务领域不得导入装配根；② 插件不得导入兄弟插件私有文件（各自仅列兄弟）。
  {
    files: ["backend/**/*.mjs"],
    ignores: [
      "backend/services.mjs",
      "backend/rpc.mjs",
      "backend/storage-validation.mjs",
      "backend/plugin-host.mjs",
      "backend/plugins/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/services.mjs", "**/services.mjs"],
              message: "业务领域不得导入装配根（services.mjs）；依赖经构造端口注入（G02/G15）。",
            },
          ],
        },
      ],
    },
  },
    {
      files: ["backend/plugins/**/*.{mjs,js,ts,tsx}"],
      plugins: moonBoundary.plugins,
      rules: {
        // G02/G15/G17/AC16：插件只能使用平台公共端口与自身文件；边界按解析路径判定，
        // 覆盖任意相对深度与动态入口之外的全部静态 import/export source。
        "moon-boundary/boundary": "error",
      },
    },
    {
      files: ["src/**/*.{ts,tsx,js,jsx,mjs}", "backend/**/*.mjs"],
      ignores: ["backend/plugins/**"],
      plugins: moonBoundary.plugins,
      rules: {
        // P0 方向性模块边界：禁止核心直连插件内部、下层反依赖上层、跨 feature/后端跨领域直连。
        "moon-boundary/layering": "error",
      },
    },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: [
      "src/features/home/**/*.{ts,tsx}",
      "src/components/composer/**/*.{ts,tsx}",
      "src/features/materials/**/*.{ts,tsx}",
      "src/features/conversation/permissions/permission-picker.tsx",
    ],
    plugins: { "moon-ui": moonUi },
    rules: {
      "moon-ui/project-tooltip": "error",
      "moon-ui/composer-controls": "error",
    },
  },
  {
    files: ["src/components/composer/composer-toolbar.tsx"],
    rules: { "moon-ui/composer-css": "error" },
  },
])
