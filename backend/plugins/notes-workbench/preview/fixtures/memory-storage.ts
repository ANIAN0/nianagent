/** Only the preview document receives this storage; the application keeps its own. */
export function installPreviewStorage() {
  const create = (): Storage => {
    const values = new Map<string, string>()
    return {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(String(key)) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => {
        values.delete(String(key))
      },
      setItem: (key, value) => {
        values.set(String(key), String(value))
      },
    }
  }
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: create(),
  })
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: create(),
  })
}

/** Explicit preview transport boundary: omitted display services must never fall through to user data. */
export function installPreviewNetwork() {
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.href
    )
    if (url.origin === location.origin && url.pathname.startsWith("/api/"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: "此演示未提供对应的隔离服务，真实宿主访问已阻止。",
            issue: {
              code: "preview_service_unavailable",
              summary: "此演示未提供对应的隔离服务，真实宿主访问已阻止。",
              severity: "info",
              recovery: "none",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
      )
    return original(input, init)
  }
}
