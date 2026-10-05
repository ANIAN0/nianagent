import type { Material } from "@/features/home/home-types"

/** Selection seam shared by candidates, focus and mixed paste. */
export type ComposerEditorElement = HTMLDivElement & {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  setSelectionRange(start: number, end: number): void
}
export function composerEditor(root: Element | null | undefined) {
  return (
    root?.querySelector<ComposerEditorElement>("[data-composer-editor]") ?? null
  )
}
export function materialMention(item: Material, cwd = "") {
  const source = item.source?.replace(/\\/gu, "/") ?? item.name
  const base = cwd.replace(/\\/gu, "/").replace(/\/$/u, "")
  const path =
    base && source.toLowerCase().startsWith(`${base.toLowerCase()}/`)
      ? source.slice(base.length + 1)
      : source
  return /\s/u.test(path) ? `@"${path}"` : `@${path}`
}
