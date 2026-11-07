export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "/", label: "搜索页面" },
  { keys: "↑ / ↓", label: "上一页 / 下一页" },
  { keys: "1", label: "画布视图" },
  { keys: "2", label: "文档视图" },
  { keys: "3", label: "切换右侧面板" },
  { keys: "F", label: "聚焦画布（隐藏侧栏与面板）" },
  { keys: "Ctrl/Cmd+B", label: "折叠 / 展开目录" },
  { keys: "Esc", label: "退出聚焦 / 圈选 / 帮助" },
  { keys: "?", label: "快捷键帮助" },
]

/** 输入场景不抢按键；内容可编辑元素与组合键一律放行。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  )
}
