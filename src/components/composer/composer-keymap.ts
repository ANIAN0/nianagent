import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"

export type ComposerComposition = { active: boolean; endedAt: number }
type ComposerKey = Pick<
  KeyboardEvent,
  | "key"
  | "keyCode"
  | "isComposing"
  | "shiftKey"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "repeat"
  | "getModifierState"
>

/** Candidate acceptance and message delivery use the same IME/modifier guard. */
export function composerKeyIntent(
  event: ComposerKey,
  composition: ComposerComposition
) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    composition.active ||
    Date.now() - composition.endedAt < 50
  )
    return "composing"
  if (event.key !== "Enter") return "other"
  if (event.altKey || event.getModifierState("AltGraph") || event.repeat)
    return "ignore"
  return event.shiftKey ? "newline" : "submit"
}

export function useComposerKeyboard<
  T extends HTMLElement = HTMLTextAreaElement,
>(onSubmit: () => void) {
  const composition = useRef<ComposerComposition>({ active: false, endedAt: 0 })
  return {
    onCompositionStart: () => {
      composition.current.active = true
    },
    onCompositionEnd: () => {
      composition.current.active = false
      composition.current.endedAt = Date.now()
    },
    onKeyDown: (event: ReactKeyboardEvent<T>) => {
      if (event.defaultPrevented) return "ignore"
      const intent = composerKeyIntent(event.nativeEvent, composition.current)
      if (intent === "ignore") event.preventDefault()
      if (intent === "submit") {
        event.preventDefault()
        onSubmit()
      }
      return intent
    },
  }
}
