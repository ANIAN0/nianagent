import { useRef, useState } from "react"
import { ArrowLeft, Menu, Moon, Sun, Monitor, Braces } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DeferredContent } from "./deferred-content"

const loadThemeMenu = () => import("./theme-menu")

export function CatalogHeader({
  environment,
  onOpenNavigation,
  theme,
  onThemeChange,
  onLeave,
}: {
  environment: string
  onOpenNavigation?: () => void
  theme: "light" | "dark" | "system"
  onThemeChange: (theme: "light" | "dark" | "system") => void
  onLeave?: () => void
}) {
  const [themeRequested, setThemeRequested] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const themeTrigger = useRef<HTMLButtonElement>(null)
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor

  return (
    <header className="api-catalog-header">
      <div className="api-catalog-header-title">
        {onOpenNavigation && (
          <Button
            className="api-catalog-navigation-toggle"
            variant="ghost"
            size="icon"
            aria-label="打开接口导航"
            onClick={onOpenNavigation}
          >
            <Menu />
          </Button>
        )}
        <Braces className="api-catalog-brand-icon" aria-hidden="true" />
        <h1>
          Moon <span>接口目录</span>
        </h1>
      </div>
      <div className="api-catalog-header-actions">
        <Button variant="ghost" size="sm" asChild>
          <a href="?desktop=desktop_get_state">桌面接口</a>
        </Button>
        <span className="api-catalog-environment" title={environment}>
          {environment}
        </span>
        {themeRequested ? (
          <DeferredContent
            load={loadThemeMenu}
            label="外观菜单"
            onDismiss={() => {
              setThemeRequested(false)
              setThemeOpen(false)
              requestAnimationFrame(() => themeTrigger.current?.focus())
            }}
            props={{
              theme,
              onThemeChange,
              open: themeOpen,
              onOpenChange: setThemeOpen,
            }}
            fallback={
              <Button
                variant="ghost"
                size="icon"
                disabled
                aria-label="正在载入外观菜单"
              >
                <ThemeIcon />
              </Button>
            }
          />
        ) : (
          <Button
            ref={themeTrigger}
            variant="ghost"
            size="icon"
            aria-label="切换接口目录外观"
            aria-haspopup="menu"
            onClick={() => {
              setThemeRequested(true)
              setThemeOpen(true)
            }}
          >
            <ThemeIcon />
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <a
            href="/"
            onClick={(event) => {
              if (
                event.button === 0 &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              )
                onLeave?.()
            }}
          >
            <ArrowLeft data-icon="inline-start" />
            返回 Moon
          </a>
        </Button>
      </div>
    </header>
  )
}
