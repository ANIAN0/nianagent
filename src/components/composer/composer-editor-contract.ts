import type { Material } from "@/lib/composer/types"

/** Selection seam shared by candidates, focus and mixed paste. */
export type ComposerEditorElement = HTMLDivElement & {
  readonly value: string
  selectionStart: number
  selectionEnd: number
  setSelectionRange(start: number, end: number): void
  /** Apply after matching text commits; requireFocus cancels on focus/owner loss. */
  setSelectionAfterChange(
    text: string,
    start: number,
    end: number,
    options?: { requireFocus?: boolean }
  ): void
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

export function composerReferenceToken(item: Material, cwd = "") {
  return item.type === "skill"
    ? `/skill:${item.name}`
    : materialMention(item, cwd)
}

/** Find a complete occurrence of an already selected reference, never infer a material. */
export function composerReferenceIndex(text: string, token: string, from = 0) {
  if (!token) return -1
  let index = text.indexOf(token, from)
  while (index >= 0) {
    const before = text[index - 1]
    const after = text[index + token.length]
    if ((!before || /\s/u.test(before)) && (!after || /\s/u.test(after)))
      return index
    index = text.indexOf(token, index + token.length)
  }
  return -1
}

export function removeComposerReferenceTokens(text: string, token: string) {
  let index = composerReferenceIndex(text, token)
  while (index >= 0) {
    text = text.slice(0, index) + text.slice(index + token.length)
    index = composerReferenceIndex(text, token, index)
  }
  return text
}
