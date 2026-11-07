import { useEffect, useState } from "react"

const KEY = "moon-notes-workbench-theme"
export type ShellTheme = "dark" | "light"

/** 壳层主题：写入 html[data-theme] 驱动 tokens.css，并记住用户选择。 */
export function useShellTheme(): [ShellTheme, (theme: ShellTheme) => void] {
  const [theme, setTheme] = useState<ShellTheme>(() => {
    try {
      return localStorage.getItem(KEY) === "light" ? "light" : "dark"
    } catch {
      return "dark"
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* 隐私模式等存储不可用时仅本次会话生效。 */
    }
  }, [theme])
  return [theme, setTheme]
}
