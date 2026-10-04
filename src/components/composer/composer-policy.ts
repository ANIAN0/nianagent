import type { HomeData, HomeDraft, Material } from "@/features/home/home-types"

/** Shared draft admission facts. Page owners add their own durable operation gates. */
export function composerDraftEligibility(
  draft: Pick<HomeDraft, "text" | "model" | "materials">,
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
  const reason = choosing
    ? "正在选择附件，选择完成后可发送。"
    : !modelAvailable
      ? "请选择可用模型后发送。"
      : unsupportedImage
        ? "当前模型不支持图片，请更换模型或移除图片。"
        : !materialReady
          ? "材料尚未准备完成，请重试失败材料或移除后发送。"
          : !hasDraft
            ? "输入文字或添加材料后发送。"
            : undefined
  return {
    hasDraft,
    modelAvailable,
    unsupportedImage,
    canSend: !reason,
    reason,
  }
}

export function composerDisplayMaterials(
  materials: Material[],
  model: string,
  inputs?: HomeData["modelInputs"]
) {
  return materials.map((item) =>
    item.type === "image" && inputs && !inputs[model]?.includes("image")
      ? {
          ...item,
          status: "failed" as const,
          error: "当前模型不支持图片，请更换模型或移除。",
        }
      : item
  )
}

/** Ordinary conversations keep one primary action; a valid next draft also exposes a quiet Stop. */
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
