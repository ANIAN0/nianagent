import * as React from "react"
import type { ComponentType } from "react"
import { transform } from "sucrase"

export const cn = (...parts: unknown[]) => parts.filter(Boolean).join(" ")

export type Compiled =
  | { ok: true; component: ComponentType }
  | { ok: false; error: string }

/** 页面源码无 import：Sucrase 经典 JSX 运行时转译后，在预注入作用域里求值。 */
export function compilePage(source: string): Compiled {
  try {
    const { code } = transform(source, {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "classic",
      jsxPragma: "React.createElement",
      jsxFragmentPragma: "Fragment",
      production: true,
      filePath: "page.tsx",
    })
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
      `"use strict";\n${code}\n;return typeof Page === "function" ? Page : null;`
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
      cn
    ) as ComponentType | null
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
