import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
const basename = (value) => normalize(value).split("/").at(-1)
export function matchModel(item, known, connection) {
  const api = connection.protocol || "openai-completions"
  const draft = {
    id: item.id,
    name: item.display_name || item.name || item.id,
    api,
    input: ["text"],
  }
  const ranked = known
    .map((model) => {
      let score =
        model.id === item.id
          ? 100
          : normalize(model.id) === normalize(item.id)
            ? 90
            : basename(model.id) === basename(item.id)
              ? 80
              : [item.id, item.display_name, item.name]
                    .filter(Boolean)
                    .some((value) => normalize(model.name) === normalize(value))
                ? 70
                : 0
      if (
        score &&
        connection.endpoint &&
        model.baseUrl?.replace(/\/$/, "") ===
          connection.endpoint.replace(/\/$/, "")
      )
        score += 1000
      return { model, score }
    })
    .filter((item) => item.score)
  const best = Math.max(0, ...ranked.map((item) => item.score))
  const matches = ranked
    .filter((item) => item.score === best)
    .map((item) => item.model)
  const metadata = {
    status: "unknown",
    sources: matches.map((model) => `${model.provider}/${model.id}`),
    conflicts: [],
  }
  if (!matches.length) return { ...draft, metadata }
  for (const field of ["reasoning", "input", "contextWindow", "maxTokens"]) {
    const values = matches.map((model) =>
      field === "input" ? [...model.input].sort() : model[field]
    )
    if (
      values.every(
        (value) => JSON.stringify(value) === JSON.stringify(values[0])
      ) &&
      values[0] !== undefined
    )
      draft[field] = values[0]
    else {
      metadata.conflicts.push(field)
      if (field === "input") draft.input = ["text"]
    }
  }
  if (draft.reasoning) {
    const supported = matches.map((model) => getSupportedThinkingLevels(model))
    const common = levels.filter((level) =>
      supported.every((values) => values.includes(level))
    )
    draft.thinkingLevelMap = Object.fromEntries(
      levels.map((level) => {
        const values = matches.map(
          (model) => model.thinkingLevelMap?.[level] ?? level
        )
        const agrees = values.every((value) => value === values[0])
        if (common.includes(level) && !agrees)
          metadata.conflicts.push(`thinkingLevelMap.${level}`)
        return [level, common.includes(level) && agrees ? values[0] : null]
      })
    )
    if (
      supported.some(
        (values) => JSON.stringify(values) !== JSON.stringify(supported[0])
      )
    )
      metadata.conflicts.push("thinkingLevelMap（采用共同等级）")
  }
  metadata.status = metadata.conflicts.length ? "partial" : "matched"
  return { ...draft, metadata }
}
