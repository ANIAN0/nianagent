import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import "./reading.css"

type Heading = { id: string; title: string; level: number }
/** The shipped plugin reader and development catalogs share navigation and reading behavior. */
export function ReadingLayout({
  navigation,
  children,
  selectionKey = "overview",
  navigationLabel = "栏目目录",
}: {
  navigation: ReactNode
  children: ReactNode
  selectionKey?: string
  navigationLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [active, setActive] = useState("")
  const main = useRef<HTMLElement>(null)
  const positions = useRef(new Map<string, number>())
  const key = `${location.pathname}:${selectionKey}`
  const pendingPosition = useRef<number | null>(null)
  useLayoutEffect(() => {
    const element = main.current
    if (!element) return
    pendingPosition.current =
      positions.current.get(key) ??
      Number(sessionStorage.getItem(`moon-reader:${key}`) ?? 0)
    element.scrollTop = pendingPosition.current
    const save = () => {
      if (pendingPosition.current !== null) return
      positions.current.set(key, element.scrollTop)
      sessionStorage.setItem(`moon-reader:${key}`, String(element.scrollTop))
    }
    element.addEventListener("scroll", save, { passive: true })
    return () => element.removeEventListener("scroll", save)
  }, [key])
  useEffect(() => {
    const element = main.current
    if (!element) return
    let timer: number | undefined
    const scan = () => {
      const counts = new Map<string, number>()
      const found = [
        ...element.querySelectorAll<HTMLElement>("article h2, article h3"),
      ]
        .filter(
          (node) =>
            !node.closest("pre, details:not([open]), [data-reader-ignore]")
        )
        .map((node) => {
          const slug = `section-${node.textContent?.trim().replace(/\s+/g, "-")}`
          const count = counts.get(slug) ?? 0
          counts.set(slug, count + 1)
          if (!node.id || node.id === node.dataset.readerHeading) {
            node.id = `${slug}${count ? `-${count + 1}` : ""}`
            node.dataset.readerHeading = node.id
          }
          return {
            id: node.id,
            title: node.textContent ?? "",
            level: Number(node.tagName.slice(1)),
          }
        })
      setHeadings((previous) =>
        JSON.stringify(previous) === JSON.stringify(found) ? previous : found
      )
      if (element.querySelector("article h1")) {
        const params = new URLSearchParams(location.search)
        const hash = location.hash
          ? decodeURIComponent(location.hash.slice(1))
          : ""
        const target = hash
          ? (document.getElementById(hash) ??
            document.getElementById(hash.replace(/^section-\d+-/, "section-")))
          : params.get("field")
            ? document.getElementById(`${params.get("fieldKind")}-fields`)
            : params.get("view") === "docs"
              ? document.getElementById("section-使用规则")
              : null
        if (target && pendingPosition.current !== null)
          target.scrollIntoView({ block: "start", behavior: "instant" })
        else if (pendingPosition.current !== null)
          element.scrollTop = pendingPosition.current
        pendingPosition.current = null
      }
    }
    const observe = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(scan, 60)
    })
    observe.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    })
    scan()
    const track = () => {
      const top = element.getBoundingClientRect().top
      const nodes = [...element.querySelectorAll<HTMLElement>("h2[id], h3[id]")]
      const current = nodes
        .filter((node) => node.getBoundingClientRect().top < top + 110)
        .at(-1)
      setActive(current?.id ?? nodes[0]?.id ?? "")
    }
    element.addEventListener("scroll", track, { passive: true })
    return () => {
      observe.disconnect()
      window.clearTimeout(timer)
      element.removeEventListener("scroll", track)
    }
  }, [selectionKey])
  const toc = (compact = false) => (
    <nav
      aria-label={compact ? "本页内容（折叠）" : "本页内容"}
      className="reader-toc-links"
    >
      {headings.map((heading) => (
        <a
          key={heading.id}
          href={`#${encodeURIComponent(heading.id)}`}
          data-level={heading.level}
          aria-current={active === heading.id ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault()
            document
              .getElementById(heading.id)
              ?.scrollIntoView({ block: "start", behavior: "instant" })
            history.replaceState(
              history.state,
              "",
              `${location.pathname}${location.search}#${encodeURIComponent(heading.id)}`
            )
            setActive(heading.id)
          }}
        >
          {heading.title}
        </a>
      ))}
    </nav>
  )
  return (
    <div className="reader-layout">
      <aside className="reader-navigation">{navigation}</aside>
      <main
        ref={main}
        className="reader-main moon-scrollbar"
        id="devtools-content"
        tabIndex={-1}
      >
        <div className="reader-compact-tools">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Menu data-icon="inline-start" />
                {navigationLabel}
              </Button>
            </DialogTrigger>
            <DialogContent className="reader-navigation-dialog">
              <DialogTitle>{navigationLabel}</DialogTitle>
              <div
                className="reader-drawer"
                onClick={(event) => {
                  if (
                    (event.target as HTMLElement).closest(
                      "a, [data-select-item]"
                    )
                  )
                    setOpen(false)
                }}
              >
                {navigation}
              </div>
            </DialogContent>
          </Dialog>
          {!!headings.length && (
            <details className="reader-compact-toc">
              <summary>本页内容</summary>
              {toc(true)}
            </details>
          )}
        </div>
        {children}
      </main>
      <aside className="reader-toc">
        <p>本页内容</p>
        {toc()}
      </aside>
    </div>
  )
}
