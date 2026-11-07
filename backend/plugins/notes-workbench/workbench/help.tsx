import { SHORTCUTS } from "./shortcuts"

/** 快捷键帮助面板；Esc 或点击遮罩关闭。 */
export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-80 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="快捷键帮助"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-[var(--text-strong)]">
            快捷键
          </h2>
          <button
            type="button"
            aria-label="关闭帮助"
            className="text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-2)]"
            onClick={onClose}
          >
            Esc
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {SHORTCUTS.map((item) => (
            <li
              key={item.keys}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-[12px] text-[var(--text-2)]">
                {item.label}
              </span>
              <kbd className="rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                {item.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
