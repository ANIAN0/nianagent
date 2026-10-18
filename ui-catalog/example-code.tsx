import { useEffect, useState } from "react"
import paths from "virtual:moon-ui-previews"
import { Button } from "@/components/ui/button"
import { fileHref } from "../devtools/content-index"

const sources = import.meta.glob<string>(
  [
    "../src/**/*.catalog.tsx",
    "../backend/plugins/**/*.catalog.tsx",
    "../api-catalog/**/*.catalog.tsx",
    "./**/*.catalog.tsx",
    "./fixtures/**/*.{ts,tsx}",
  ],
  { query: "?raw", import: "default" }
)
const projectPath = (path: string) =>
  path.replace(/^\.\.\//, "").replace(/^\.\//, "ui-catalog/")
function dependencies(path: string, code: string) {
  return [...code.matchAll(/from\s+["']([^"']+)["']/g)].flatMap((match) => {
    if (!match[1]!.startsWith(".")) return []
    const absolute = new URL(
      match[1]!,
      `https://source.invalid/${projectPath(path)}`
    )
    const candidate = absolute.pathname.slice(1)
    return Object.keys(sources).filter(
      (key) =>
        key.replace(/^\.\.\//, "").replace(/^\.\//, "ui-catalog/") ===
          candidate ||
        key.replace(/^\.\.\//, "").replace(/^\.\//, "ui-catalog/") ===
          candidate + ".tsx" ||
        key.replace(/^\.\.\//, "").replace(/^\.\//, "ui-catalog/") ===
          candidate + ".ts"
    )
  })
}
export function ExampleCode({ id }: { id: string }) {
  const initial = paths[id] ?? ""
  const [path, setPath] = useState(initial)
  const [source, setSource] = useState({ path: "", code: "", error: "" })
  const [loaded, setLoaded] = useState(false)
  const [related, setRelated] = useState<string[]>([])
  useEffect(() => {
    if (!loaded) return
    let disposed = false
    const load =
      sources[path] ?? (() => Promise.reject(new Error("无法读取此示例源文件")))
    void load().then(
      (text) => {
        if (disposed) return
        setSource({ path, code: text, error: "" })
        setRelated((previous) => [
          ...new Set([initial, ...previous, ...dependencies(path, text)]),
        ])
      },
      (cause: unknown) => {
        if (!disposed) setSource({ path, code: "", error: String(cause) })
      }
    )
    return () => {
      disposed = true
    }
  }, [path, loaded, initial])
  return (
    <details
      className="catalog-example-code"
      onToggle={(event) => {
        if (event.currentTarget.open) setLoaded(true)
      }}
    >
      <summary>查看示例代码</summary>
      <p>
        这里读取运行预览所用的展示定义；场景通过导入正式组件和隔离服务装配。可继续查看引用的场景源文件。
      </p>
      <div className="reader-related">
        {[...new Set([initial, ...related])].map((file) => (
          <Button
            key={file}
            variant={path === file ? "secondary" : "outline"}
            size="sm"
            onClick={() => setPath(file)}
          >
            {file.split("/").at(-1)}
          </Button>
        ))}
      </div>
      <a
        href={fileHref(
          path.replace(/^\.\.\//, "").replace(/^\.\//, "ui-catalog/")
        )}
      >
        {path}
      </a>
      {source.path === path && source.error ? (
        <p role="alert">{source.error}</p>
      ) : (
        <pre>
          <code>{source.path === path ? source.code : "正在读取示例…"}</code>
        </pre>
      )}
    </details>
  )
}
