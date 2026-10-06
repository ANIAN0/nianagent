import type { Material } from "@/features/home/home-types"
import {
  composerReferenceToken,
  removeComposerReferenceTokens,
} from "../../components/composer/composer-editor-contract.ts"

/** Remove this reference's exact tokens, preserving other calls and prose. */
export function removeComposerMaterial<
  T extends { text: string; materials: Material[] },
>(draft: T, id: string, cwd = ""): T {
  const removed = draft.materials.find((item) => item.id === id)
  const token =
    removed &&
    removed.presentation !== "attachment" &&
    ["skill", "file", "directory"].includes(removed.type ?? "")
      ? composerReferenceToken(removed, cwd)
      : undefined
  return {
    ...draft,
    text: token ? removeComposerReferenceTokens(draft.text, token) : draft.text,
    materials: draft.materials.filter((item) => item.id !== id),
  }
}

export function insertComposerText(
  text: string,
  inserted: string,
  start: number,
  end: number
) {
  return text.slice(0, start) + inserted + text.slice(end)
}
