function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
}

function parseAttributes(raw) {
  const attrs = {}
  const re = /([a-zA-Z0-9_:-]+)="([^"]*)"/g
  let match
  while ((match = re.exec(raw)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2])
  }
  return attrs
}

function parseBounds(boundsStr) {
  const match = String(boundsStr || "").match(
    /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/
  )
  if (!match) return null
  const left = Number(match[1])
  const top = Number(match[2])
  const right = Number(match[3])
  const bottom = Number(match[4])
  if (right <= left || bottom <= top) return null
  return {
    left,
    top,
    right,
    bottom,
    center: [Math.round((left + right) / 2), Math.round((top + bottom) / 2)],
  }
}

export function parseUiTreeXml(xmlText, options = {}) {
  const maxNodes = options.maxNodes ?? 180
  const includeNonInteractive = Boolean(options.includeNonInteractive)
  const nodes = []
  const refs = new Map()
  const tagRe = /<node\b([^>]*?)\/?>/g
  let match
  let index = 0

  while ((match = tagRe.exec(xmlText)) !== null) {
    const attrs = parseAttributes(match[1])
    const bounds = parseBounds(attrs.bounds)
    if (!bounds) continue

    const text = (attrs.text || "").trim()
    const contentDesc = (attrs["content-desc"] || "").trim()
    const resourceId = (attrs["resource-id"] || "").trim()
    const cls = (attrs.class || "").split(".").pop() || ""
    const clickable = attrs.clickable === "true"
    const longClickable = attrs["long-clickable"] === "true"
    const scrollable = attrs.scrollable === "true"
    const editable =
      cls.includes("EditText") || attrs.focused === "true" && attrs.focusable === "true"
    const checkable = attrs.checkable === "true"
    const checked = attrs.checked === "true"
    const enabled = attrs.enabled !== "false"

    const interactive =
      clickable || longClickable || scrollable || editable || checkable
    const hasLabel = Boolean(text || contentDesc)

    if (!includeNonInteractive && !interactive && !hasLabel) {
      continue
    }

    index += 1
    const ref = `@e${index}`
    const item = {
      ref,
      class: cls,
      text: text || undefined,
      contentDesc: contentDesc || undefined,
      resourceId: resourceId || undefined,
      center: bounds.center,
      bounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
      clickable,
      editable: editable || undefined,
      scrollable: scrollable || undefined,
      checked: checkable ? checked : undefined,
      enabled,
    }
    nodes.push(item)
    refs.set(ref, {
      center: bounds.center,
      bounds: item.bounds,
      text: text || contentDesc || cls,
    })

    if (nodes.length >= maxNodes) break
  }

  return {
    total: nodes.length,
    nodes,
    refs,
  }
}
