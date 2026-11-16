import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

// DSH 同规格：溢出 ≥8px 才启动（防抖动），0.03px/ms 匀速爬行，
// 爬行时两端 12px 渐隐 mask，到最远端去掉省略号，离开一步回零，触屏不触发。
const CRAWL_SPEED_PX_PER_MS = 0.03
const OVERFLOW_THRESHOLD_PX = 8
const MASK_FADE_PX = 12

export function MarqueeTitle({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const viewport = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hovering, setHovering] = useState(false)
  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () =>
      setOverflow(Math.max(0, element.scrollWidth - element.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])
  useEffect(() => {
    if (!hovering || overflow < OVERFLOW_THRESHOLD_PX) return
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      const elapsed = now - last
      last = now
      setOffset((current) => {
        const next = current + CRAWL_SPEED_PX_PER_MS * elapsed
        if (next >= overflow) return overflow
        frame = requestAnimationFrame(step)
        return next
      })
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [hovering, overflow])
  const overflowLatest = useRef(0)
  useEffect(() => {
    overflowLatest.current = overflow
  }, [overflow])
  const crawling = hovering && overflow >= OVERFLOW_THRESHOLD_PX
  const atEnd = overflow > 0 && offset >= overflow
  const mask =
    crawling && !atEnd
      ? `linear-gradient(to right, transparent 0, black ${MASK_FADE_PX}px, black calc(100% - ${MASK_FADE_PX}px), transparent 100%)`
      : undefined
  return (
    <span
      ref={viewport}
      className={cn(
        "relative block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
        className
      )}
      data-crawl={crawling ? "true" : undefined}
      style={{
        // 到最远端后去掉省略号；transform 不改变布局溢出，省略号在爬行期间保持。
        textOverflow: atEnd ? "clip" : undefined,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return
        setHovering(true)
        // reduced-motion：进入直接跳到最远端，不做爬行动画。
        if (
          reduceMotion.current &&
          overflowLatest.current >= OVERFLOW_THRESHOLD_PX
        )
          setOffset(overflowLatest.current)
      }}
      onPointerLeave={() => {
        // 离开一步回零：不反向爬行。
        setHovering(false)
        setOffset(0)
      }}
    >
      <span
        className="inline-block will-change-transform"
        style={{
          transform: offset > 0 ? `translateX(${-offset}px)` : undefined,
        }}
      >
        {text}
      </span>
    </span>
  )
}
