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
  const track = useRef<HTMLSpanElement>(null)
  const animationRef = useRef<Animation | null>(null)
  const [overflow, setOverflow] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
  useEffect(() => {
    animationRef.current?.cancel()
    animationRef.current = null
    const target = track.current
    if (!target) return

    if (!hovering || overflow < OVERFLOW_THRESHOLD_PX) {
      target.style.transform = ""
      return
    }

    if (reduceMotion.current) {
      target.style.transform = `translateX(${-overflow}px)`
      return
    }

    const duration = overflow / CRAWL_SPEED_PX_PER_MS
    const animation = target.animate(
      [
        { transform: "translateX(0px)" },
        { transform: `translateX(${-overflow}px)` },
      ],
      {
        duration,
        easing: "linear",
        fill: "forwards",
      }
    )
    animationRef.current = animation
    animation.onfinish = () => {
      if (animationRef.current === animation) {
        setAtEnd(true)
      }
    }
    return () => {
      animation.onfinish = null
      animation.cancel()
      if (animationRef.current === animation) {
        animationRef.current = null
      }
    }
  }, [hovering, overflow])
  const crawling = hovering && overflow >= OVERFLOW_THRESHOLD_PX
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
        const element = viewport.current
        if (!element) return
        const distance = Math.max(0, element.scrollWidth - element.clientWidth)
        setOverflow(distance)
        setHovering(distance >= OVERFLOW_THRESHOLD_PX)
        // reduced-motion：进入直接跳到最远端，不做爬行动画。
        if (reduceMotion.current && distance >= OVERFLOW_THRESHOLD_PX) {
          setAtEnd(true)
        }
      }}
      onPointerLeave={() => {
        // 离开一步回零：不反向爬行。
        setHovering(false)
        setAtEnd(false)
      }}
    >
      <span
        ref={track}
        className={cn("inline-block", crawling && "will-change-transform")}
      >
        {text}
      </span>
    </span>
  )
}
