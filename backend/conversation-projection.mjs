// Presentation facts derived from official Pi content/results. This module does
// not run tools, interpret model prose as effects, or own a second transcript.
import { resolve, relative, isAbsolute } from "node:path"
import { homedir } from "node:os"

const resultText = (content) =>
  typeof content === "string"
    ? content
    : (Array.isArray(content) ? content : [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")

export function projectedResult(result) {
  const text = resultText(result?.content)
  return {
    result: text.length > 32000 ? text.slice(0, 32000) + "\n[输出已截断]" : text,
    resultLength: text.length,
    resultTruncated: text.length > 32000 || result?.details?.truncation?.truncated === true,
  }
}

export function projectedDetails(result) {
  const source = result?.details
  if (!source || typeof source !== "object") return undefined
  const details = {
    ...(typeof source.diff === "string" ? { diff: source.diff } : {}),
    ...(typeof source.patch === "string" ? { patch: source.patch } : {}),
    ...(Number.isInteger(source.firstChangedLine) && source.firstChangedLine > 0
      ? { firstChangedLine: source.firstChangedLine }
      : {}),
  }
  return Object.keys(details).length ? details : undefined
}

export function toolTarget(part, cwd) {
  const input = part.arguments
  if (!input || typeof input !== "object") return undefined
  if (["read", "edit", "write"].includes(part.name) && typeof input.path === "string") {
    // Match Pi's documented @/~/Unicode-space normalization. It is a requested
    // path; a realpath check remains mandatory before opening local content.
    let value = input.path.replace(/^@/, "").replace(/[\u00a0\u202f]/g, " ")
    if (value === "~" || value.startsWith("~/") || value.startsWith("~\\"))
      value = homedir() + value.slice(1)
    const path = resolve(cwd, value)
    const local = relative(cwd, path)
    return {
      kind: "file",
      path,
      displayPath: local && !local.startsWith("..") && !isAbsolute(local) ? local : path,
      requestedPath: input.path,
      ...(Number.isInteger(input.offset) && input.offset > 0 ? { line: input.offset } : {}),
      ...(Number.isInteger(input.limit) && input.limit > 0 ? { lineCount: input.limit } : {}),
    }
  }
  if (["bash", "powershell"].includes(part.name) && typeof input.command === "string")
    return { kind: "command", command: input.command, cwd }
  return undefined
}

export function fileArtifact(part, target, status) {
  if (status !== "success" || target?.kind !== "file" || !["write", "edit"].includes(part.name))
    return undefined
  // Pi write itself has no creation/overwrite metadata. Missing facts stay
  // 'write'; existence observations and model prose cannot refine this fact.
  const operation = part.name === "edit" ? "edit" : "write"
  return { path: target.path, displayPath: target.displayPath, operation }
}
