// @ts-check
// 预览会话运行时（T13，E4 spike 转正）：
// - 随机会话子域 `<sid>.localhost` 与管理端不同 origin；sid 仅小写（DNS 大小写不敏感）
// - Host 校验先于会话校验；未知会话/IP Host 拒绝
// - 完整 CSP（default-src 'none' 全套指令）；预览页可被工作台同源外壳内嵌
// - 桥以同源外部脚本注入（head 内、产物脚本之前），参数走 data 属性；无 head/body 结构明确拒绝
import { randomBytes } from "node:crypto"

const SESSION_PATTERN = /^[a-z0-9]{6}$/
export const MAX_SESSIONS = 32
// AC09：闲置过期——open 时清扫超时未用会话，反复打开/关闭与比较切换不耗尽上限
const SESSION_TTL_MS = 30 * 60000

export const previewCsp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' http://127.0.0.1:httpPort http://localhost:httpPort",
]

export const previewHeaders = (httpPort) => ({
  "content-security-policy": previewCsp
    .join("; ")
    .replaceAll("httpPort", String(httpPort)),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
})

/** 会话表：sid → {versionId, createdAt, lastUsed}。
 * AC09 生命周期：每次 open 生成独立 sid（Reader 一个实例持有一个会话能力）；
 * 显式 release（归属校验：versionId 不匹配不释放）与闲置过期双通道回收；
 * 上限仅在泄漏场景兜底，超限明确拒绝（不自动挤掉在用会话）。 */
export class PreviewSessions {
  constructor() {
    this.map = new Map()
  }

  open(versionId) {
    const now = Date.now()
    for (const [sid, session] of this.map)
      if (now - session.lastUsed > SESSION_TTL_MS) this.map.delete(sid)
    if (this.map.size >= MAX_SESSIONS) {
      const error = new Error("预览会话已达上限，请关闭闲置预览后重试。")
      error.code = "limit_exceeded"
      throw error
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const sid = randomBytes(4).toString("hex").slice(0, 6)
      if (this.map.has(sid)) continue
      this.map.set(sid, { versionId, createdAt: now, lastUsed: now })
      return sid
    }
    const error = new Error("无法分配独立预览会话，请重试。")
    error.code = "internal_error"
    throw error
  }

  resolve(sid) {
    if (!SESSION_PATTERN.test(sid)) return null
    const session = this.map.get(sid)
    if (!session) return null
    const now = Date.now()
    if (now - session.lastUsed > SESSION_TTL_MS) {
      this.map.delete(sid)
      return null
    }
    session.lastUsed = now
    return session
  }

  /** AC09：归属校验的释放——sid 存在且（提供 versionId 时）版本匹配才释放；未知 sid 幂等。 */
  release(sid, versionId) {
    if (!SESSION_PATTERN.test(sid)) return false
    const session = this.map.get(sid)
    if (!session) return false
    if (versionId !== undefined && session.versionId !== versionId) return false
    return this.map.delete(sid)
  }

  close(sid) {
    return this.map.delete(sid)
  }
}

export const isPreviewHost = (hostHeader, httpPort) => {
  if (typeof hostHeader !== "string") return null
  const match = hostHeader.match(/^([a-z0-9.]+):(\d+)$/)
  if (!match) return null
  const [, hostname, port] = match
  if (Number(port) !== Number(httpPort)) return null
  if (hostname === "127.0.0.1" || hostname === "localhost") return null // 管理端
  if (hostname.endsWith(".localhost")) {
    const sid = hostname.slice(0, -".localhost".length)
    if (SESSION_PATTERN.test(sid)) return sid
  }
  return null
}

/** 桥脚本：体验/评论模式分离；评论模式捕获点击、描述目标并发回父页（工作台外壳）。 */
export const bridgeScript = (parentOrigins) => `(() => {
  const parentOrigins = ${JSON.stringify(parentOrigins)};
  let mode = "experience";
  let overlay;
  const clearOverlay = () => { if (overlay) { overlay.remove(); overlay = undefined; } };
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      kind: "ui",
      page: location.pathname,
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      classes: typeof element.className === "string" ? element.className.slice(0, 120) : "",
      text: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
      attributes: Object.fromEntries(
        Array.from(element.attributes)
          .filter((attribute) => attribute.name !== "style")
          .slice(0, 8)
          .map((attribute) => [attribute.name, attribute.value.slice(0, 80)])
      ),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      viewport: { width: innerWidth, height: innerHeight },
    };
  };
  const collect = () => ({
    page: location.pathname,
    elements: Array.from(
      document.querySelectorAll("button,a,input,select,textarea,h1,h2,h3,h4,[role='button']")
    )
      .slice(0, 200)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || "",
          text: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      }),
  });
  let parentOrigin = parentOrigins[0];
  let domReady = document.readyState !== "loading";
  let pendingFocus = null;
  let completedRequest = null;
  const reply = (message) => parent.postMessage(message, parentOrigin);
  const failFocus = (message, reason) => {
    completedRequest = { type: "moon-preview-focus-miss", requestId: message.requestId, reason };
    reply(completedRequest);
  };
  const paint = (element) => {
    const rect = element.getBoundingClientRect();
    clearOverlay();
    overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #f59e0b;background:rgba(245,158,11,.15);";
    overlay.style.left = rect.x + "px";
    overlay.style.top = rect.y + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    document.documentElement.appendChild(overlay);
  };
  const applyFocus = (message) => {
    if (typeof message.requestId !== "string" || !message.requestId) return;
    if (!domReady) { pendingFocus = message; return; }
    if (completedRequest?.requestId === message.requestId) { reply(completedRequest); return; }
    const target = message.target;
    if (!target || typeof target.page !== "string") { failFocus(message, "page"); return; }
    let destination;
    try { destination = new URL(target.page, location.href); }
    catch { failFocus(message, "page"); return; }
    if (!target.page.startsWith("/") || target.page.startsWith("//") || destination.origin !== location.origin || destination.search || destination.hash) {
      failFocus(message, "page"); return;
    }
    if (destination.pathname !== location.pathname) {
      try {
        sessionStorage.setItem("moon-preview-pending-focus", JSON.stringify({ ...message, parentOrigin }));
        location.assign(destination.pathname);
      } catch { failFocus(message, "page"); }
      return;
    }
    // 有明确ID时不得退回到同文案的另一个元素；无ID仅接受唯一匹配。
    let element = null;
    if (typeof target.id === "string" && target.id) element = document.getElementById(target.id);
    else if (typeof target.tag === "string" && /^[a-z][a-z0-9-]*$/i.test(target.tag)) {
      const matches = Array.from(document.getElementsByTagName(target.tag)).filter(
        el => (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120) === (target.text || "").slice(0, 120)
      );
      if (matches.length === 1) element = matches[0];
    }
    if (!element) { failFocus(message, "element"); return; }
    element.scrollIntoView({ block: "center" });
    paint(element);
    completedRequest = { type: "moon-preview-focus-ok", requestId: message.requestId };
    reply(completedRequest);
  };
  window.addEventListener("message", (event) => {
    if (event.source !== parent || !parentOrigins.includes(event.origin)) return;
    parentOrigin = event.origin;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "moon-preview-mode") {
      if (message.mode !== "comment" && message.mode !== "experience") return;
      const changed = mode !== message.mode;
      mode = message.mode;
      if (changed && mode === "experience") clearOverlay();
    } else if (message.type === "moon-preview-collect") {
      if (domReady) reply({ type: "moon-preview-inventory", ...collect() });
    } else if (message.type === "moon-preview-focus") applyFocus(message);
  });
  document.addEventListener(
    "click",
    (event) => {
      if (mode !== "comment") return;
      event.preventDefault();
      event.stopPropagation();
      const target = describe(event.target);
      paint(event.target);
      reply({ type: "moon-preview-target", target });
    },
    true
  );
  const postInventory = () => reply({ type: "moon-preview-inventory", ...collect() });
  let inventoryTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(inventoryTimer);
    inventoryTimer = setTimeout(postInventory, 800);
  });
  const ready = () => {
    domReady = true;
    let restored;
    try {
      const saved = sessionStorage.getItem("moon-preview-pending-focus");
      sessionStorage.removeItem("moon-preview-pending-focus");
      if (saved) restored = JSON.parse(saved);
    } catch {
      reply({ type: "moon-preview-notice", message: "跨页定位记录读取失败，请重新点击意见。" });
    }
    if (restored && parentOrigins.includes(restored.parentOrigin)) parentOrigin = restored.parentOrigin;
    // 新的父层请求优先于导航前的记录；不依赖固定延时猜测DOM是否可用。
    const request = pendingFocus || restored;
    pendingFocus = null;
    if (request) applyFocus(request);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    reply({ type: "moon-preview-ready" });
  };
  if (domReady) ready();
  else document.addEventListener("DOMContentLoaded", ready, { once: true });

})();`

const ORIGINS_JSON = (httpPort) =>
  JSON.stringify([
    `http://127.0.0.1:${httpPort}`,
    `http://localhost:${httpPort}`,
  ])

/** 在合法 HTML 的 head 内、产物脚本之前注入桥引用；结构不合法明确拒绝。 */
export const injectBridge = (html, bridgePath, httpPort) => {
  const tag = `<script src="${bridgePath}" data-moon-bridge="1" data-parent-origin='${ORIGINS_JSON(httpPort)}'></script>`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n  ${tag}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /<html[^>]*>/i,
      (match) => `${match}\n<head>${tag}</head>`
    )
  }
  const error = new Error("预览入口缺少 head/html 结构，桥注入失败。")
  error.code = "unsupported_artifact"
  throw error
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
}

export const assetContentType = (path) => {
  const dot = path.lastIndexOf(".")
  return TYPES[path.slice(dot).toLowerCase()] ?? "application/octet-stream"
}
