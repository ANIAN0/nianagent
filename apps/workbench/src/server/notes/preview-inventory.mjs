import { WorkbenchError } from "./errors.mjs"

// 运行时快照只作有时间标记的辅助证据；不替换版本产物或猜测缺失元素。
export class PreviewInventory {
  entries = new Map()

  get(versionId) {
    return this.entries.get(versionId)
  }

  capture(versionId, manifest, page, elements) {
    const invalid = () => {
      throw new WorkbenchError(
        "validation_failed",
        "元素清单的页面或元素结构无效。"
      )
    }
    if (typeof page !== "string" || !Object.hasOwn(manifest.routes, page))
      invalid()
    if (!Array.isArray(elements) || elements.length > 200) invalid()
    const snapshot = elements.map((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element))
        invalid()
      if (
        typeof element.tag !== "string" ||
        !/^[a-z][a-z0-9-]{0,31}$/i.test(element.tag)
      )
        invalid()
      if (
        typeof element.id !== "string" ||
        element.id.length > 128 ||
        typeof element.text !== "string" ||
        element.text.length > 120
      )
        invalid()
      const rect = element.rect
      if (
        !rect ||
        ["x", "y", "width", "height"].some(
          (key) => typeof rect[key] !== "number" || !Number.isFinite(rect[key])
        ) ||
        rect.width < 0 ||
        rect.height < 0
      )
        invalid()
      return {
        tag: element.tag,
        id: element.id,
        text: element.text,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }
    })
    if (!this.entries.has(versionId) && this.entries.size >= 128)
      throw new WorkbenchError(
        "limit_exceeded",
        "运行时元素清单已达128个版本上限，请重启工作台释放缓存。"
      )
    const entry = this.entries.get(versionId) ?? { pages: Object.create(null) }
    entry.pages[page] = {
      capturedAt: new Date().toISOString(),
      elements: snapshot,
    }
    this.entries.set(versionId, entry)
    return snapshot.length
  }
}
