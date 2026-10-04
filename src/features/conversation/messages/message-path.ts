/** Parse Markdown references only; authority and realpath checks stay in the host. */
export function localMessagePath(href: string | undefined): string | undefined {
  if (!href || href.startsWith("#") || href.startsWith("//")) return undefined
  let path: string
  try {
    path = decodeURIComponent(href.split("#", 1)[0]!)
  } catch {
    return undefined
  }
  if (/^file:\/\//i.test(path)) path = path.replace(/^file:\/\/\/?/i, "")
  if (
    !/^[A-Za-z]:[\\/]/.test(path) &&
    /^[a-z][a-z\d+.-]*:/i.test(path.trimStart())
  )
    return undefined
  // URI fragments are navigation metadata. An encoded %23 remains a real
  // filename character rather than being mistaken for a fragment.
  if (!path.trim() || path.includes("?")) return undefined
  for (let index = 0; index < path.length; index += 1)
    if (path.charCodeAt(index) < 32) return undefined
  return path
}

export function isExternalMessageLink(href: string | undefined) {
  return Boolean(href && /^(?:https?:\/\/|mailto:)/i.test(href))
}
