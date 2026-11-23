import type { ModelConnection, ModelDefinition } from "./model-types"

export const connectionPresets = [
  {
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    recommended: ["deepseek-flash", "deepseek-v4-pro"],
  },
  {
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    recommended: ["openai/gpt-5-mini"],
  },
] as const

export function recommendedModel(
  connection: ModelConnection,
  candidates: ModelDefinition[]
) {
  const endpoint = connection.endpoint.trim().replace(/\/+$/, "")
  const preset = connectionPresets.find((item) => item.endpoint === endpoint)
  if (connection.kind !== "api" || connection.protocol !== "openai-completions")
    return undefined
  const complete = candidates.filter(
    (model) =>
      model.reasoning !== undefined &&
      !!model.contextWindow &&
      !!model.maxTokens &&
      model.maxTokens <= model.contextWindow &&
      !model.metadata?.conflicts.length
  )
  if (!preset) return candidates.length === 1 ? complete[0] : undefined
  for (const id of preset.recommended) {
    const model = complete.find((candidate) => candidate.id === id)
    if (model) return model
  }
}
