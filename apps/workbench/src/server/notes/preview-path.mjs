// @ts-check

export const previewBridgePath = "/__moon-bridge.js"

/** @param {string} pathname @returns {"artifact" | "bridge" | null} */
export function classifyPreviewPath(pathname) {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null

  try {
    const segments = pathname.slice(1).split("/").map(decodeURIComponent)
    if (
      segments.some(
        (segment) =>
          segment === "." ||
          segment === ".." ||
          /[/\\]/.test(segment) ||
          [...segment].some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
          )
      )
    )
      return null

    const [first] = segments
    if (first === "api" || first === "_next") return null
    if (first === previewBridgePath.slice(1))
      return pathname === previewBridgePath ? "bridge" : null
    return "artifact"
  } catch {
    return null
  }
}
