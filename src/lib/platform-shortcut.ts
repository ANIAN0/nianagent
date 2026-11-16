/** 快捷键提示按平台呈现修饰键；aria-keyshortcuts 与文案同源。 */
export function isMacLikePlatform() {
  return (
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad/i.test(navigator.userAgent ?? "")
  )
}
export function shortcutLabel(key: string) {
  return `${isMacLikePlatform() ? "⌘" : "Ctrl"}+${key}`
}
export function ariaKeyShortcuts(key: string) {
  return `${isMacLikePlatform() ? "Meta" : "Control"}+${key}`
}
