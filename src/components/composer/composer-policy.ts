import type { HomeData, HomeDraft, Material } from "@/features/home/home-types"
import { unresolvedComposerQuery } from "./composer-draft-query.ts"
import {
  fileReferenceFeedback,
  isFileReference,
} from "../../features/materials/material-reference-feedback.ts"

type DraftBlock = {
  kind: "choosing" | "model" | "image" | "materials" | "query" | "empty"
  message: string
}

/** Normalize an editable working copy, never an immutable submission or history. */
export function editableComposerDraft(draft: HomeDraft): HomeDraft {
  const leading = draft.text.trimStart().match(/^\/([^\s]+)/u)?.[1]
  return {
    ...draft,
    materials: draft.materials.filter(
      (item) => item.type !== "skill" && item.kind !== "Skill"
    ),
    command: draft.command?.name === leading ? draft.command : undefined,
  }
}

/** Shared draft admission facts. Page owners add their own durable operation gates. */
export function composerDraftEligibility(
  draft: Pick<HomeDraft, "text" | "model" | "materials" | "command">,
  data: Pick<HomeData, "models" | "modelInputs">,
  ready: boolean,
  choosing = false
) {
  const hasDraft = !!draft.text.trim() || draft.materials.length > 0
  const unsupportedImage = draft.materials.some(
    (item) =>
      item.type === "image" &&
      !!data.modelInputs &&
      !data.modelInputs[draft.model]?.includes("image")
  )
  const materialReady =
    ready &&
    draft.materials.every((item) => !item.status || item.status === "ready")
  const modelAvailable = data.models.includes(draft.model)
  const unreadyReference = draft.materials.find(
    (item) => isFileReference(item) && !!item.status && item.status !== "ready"
  )
  const unresolved = unresolvedComposerQuery(
    draft.text,
    draft.materials,
    draft.command?.name
  )
  const block: DraftBlock | undefined = choosing
    ? { kind: "choosing", message: "正在选择附件，选择完成后可发送。" }
    : !modelAvailable
      ? { kind: "model", message: "请选择可用模型后发送。" }
      : unsupportedImage
        ? {
            kind: "image",
            message: "当前模型不支持图片，请更换模型或移除图片。",
          }
        : !materialReady
          ? {
              kind: "materials",
              message:
                (unreadyReference &&
                  fileReferenceFeedback(unreadyReference)?.block) ||
                "材料尚未准备完成，请重试失败材料或移除后发送。",
            }
          : unresolved
            ? { kind: "query", message: unresolved }
            : !hasDraft
              ? { kind: "empty", message: "输入文字或添加材料后发送。" }
              : undefined
  return {
    hasDraft,
    modelAvailable,
    unsupportedImage,
    canSend: !block,
    reason: block?.message,
    reasonKind: block?.kind,
  }
}

export function composerDisplayMaterials(
  materials: Material[],
  model: string,
  inputs?: HomeData["modelInputs"]
) {
  return materials.map((item) =>
    item.type === "image" &&
    item.status === "ready" &&
    inputs &&
    !inputs[model]?.includes("image")
      ? {
          ...item,
          incompatible: true,
          error: "当前模型不支持图片，请更换模型或移除。",
        }
      : item
  )
}

/** DSH ordinary-session policy: Stop for empty/blocked drafts, Send for actionable input. */
export function composerPrimaryAction({
  running = false,
  stopping = false,
  hasDraft,
  canSubmit,
  command = false,
}: {
  running?: boolean
  stopping?: boolean
  hasDraft: boolean
  canSubmit: boolean
  command?: boolean
}) {
  if (stopping) return "stopping"
  if (running && (!hasDraft || !canSubmit || command)) return "stop"
  if (command) return "compact"
  return running ? "queue" : "send"
}
