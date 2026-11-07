import * as React from "react"
import type { ComponentType } from "react"
import { transform } from "sucrase"

export const cn = (...parts: unknown[]) => parts.filter(Boolean).join(" ")

/** moon-ui 注册表：页面源码 `import { X } from "moon-ui"` 的解析来源，由预览 bundle 提供。 */
export type MoonUiScope = Record<string, unknown>

export type Compiled =
  | { ok: true; component: ComponentType<Record<string, unknown>> }
  | { ok: false; error: string }

const MOON_IMPORT =
  /^[ \t]*import\s*\{([^}]*)\}\s*from\s*["']moon-ui["']\s*;?[ \t]*\r?\n?/gm
const STRAY_IMPORT = /^[ \t]*import\b[^"'\n]*["']([^"'\n]+)["']/m

/** 页面源码转译：仅允许具名导入 moon-ui 注册表组件；其余 import 一律拒绝。 */
export function compilePage(
  source: string,
  moonUi: MoonUiScope | null = null
): Compiled {
  try {
    const moonImports: string[] = []
    const stripped = source.replace(
      MOON_IMPORT,
      (_match: string, names: string) => {
        for (const raw of names.split(",")) {
          const name = raw.trim()
          if (!name) continue
          if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
            throw new Error(`moon-ui 导入名无效：${name}`)
          moonImports.push(name)
        }
        return ""
      }
    )
    const stray = stripped.match(STRAY_IMPORT)
    if (stray)
      return {
        ok: false,
        error: `页面源码不支持 import "${stray[1]}"；只能从 "moon-ui" 具名导入白名单组件。`,
      }
    if (moonImports.length && !moonUi)
      return { ok: false, error: "moon-ui 注册表未加载；请重载页面资源。" }
    const { code } = transform(stripped, {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "classic",
      jsxPragma: "React.createElement",
      jsxFragmentPragma: "Fragment",
      production: true,
      filePath: "page.tsx",
    })
    const prelude = moonImports.length
      ? `for (const name of ${JSON.stringify(moonImports)}) if (!(name in MoonUI)) throw new Error("moon-ui 未提供组件：" + name);
const { ${moonImports.join(", ")} } = MoonUI;
`
      : ""
    const factory = new Function(
      "React",
      "Fragment",
      "useState",
      "useEffect",
      "useRef",
      "useMemo",
      "useCallback",
      "useReducer",
      "useLayoutEffect",
      "cn",
      "MoonUI",
      `"use strict";
${prelude}${code}
;return typeof Page === "function" ? Page : null;`
    )
    const component = factory(
      React,
      React.Fragment,
      React.useState,
      React.useEffect,
      React.useRef,
      React.useMemo,
      React.useCallback,
      React.useReducer,
      React.useLayoutEffect,
      cn,
      moonUi ?? {}
    ) as ComponentType<Record<string, unknown>> | null
    if (!component)
      return { ok: false, error: "源码末尾未定义 function Page() {...}。" }
    return { ok: true, component }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
