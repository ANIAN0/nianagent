import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"
import moonUi from "./scripts/eslint-ui-consistency.mjs"

export default defineConfig([
  globalIgnores(["dist", "src-tauri/runtime", "src-tauri/target", ".dev"]),
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
    files: ["src/features/home/composer-toolbar.tsx"],
    rules: { "moon-ui/composer-css": "error" },
  },
])
