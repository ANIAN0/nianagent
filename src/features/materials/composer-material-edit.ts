import type { Material } from "@/features/home/home-types"

/** Removing a selected Skill also releases only its leading bound command. */
export function removeComposerMaterial<
  T extends { text: string; materials: Material[] },
>(draft: T, id: string): T {
  const removed = draft.materials.find((item) => item.id === id)
  // Submission trims leading whitespace before Pi parses the command. Resolve
  // that same call here while preserving the user's original spacing/body.
  const bound = /^(\s*)\/skill:([^\s]+)(?=\s|$)/u.exec(draft.text)
  const releasesCommand =
    removed?.type === "skill" && bound?.[2] === removed.name
  return {
    ...draft,
    text: releasesCommand
      ? bound![1] + draft.text.slice(bound![0].length).replace(/^[ \t]/u, "")
      : draft.text,
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
