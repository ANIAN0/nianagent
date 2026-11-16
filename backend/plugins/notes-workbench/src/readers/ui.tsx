// UI 产物阅读器（T14）：随机会话子域 iframe 内嵌，产物免构建直接体验。
// 体验/评论模式分离：评论模式下桥捕获点击（阻止业务动作）并回传元素目标；父页据此开评论框。
import { useEffect, useRef, useState } from "react"
import type { ReaderProps } from "../reader-registry"
import { v2Api } from "../v2-api"
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group"

export function UiReader({
  version,
  onTargetSelect,
  focusRequest,
  onReport,
}: ReaderProps) {
  // 预览结果按 versionId 归属：切换版本时 current 立即失配回到加载态，
  // setState 全部发生在 promise 回调（不因版本切换在 effect 同步清空）。
  const [loaded, setLoaded] = useState<{
    versionId: string
    sessionUrl: string | null
    sid: string
    error: string
  } | null>(null)
  const [mode, setMode] = useState<"experience" | "comment">("experience")
  const [notice, setNotice] = useState("")
  const frameRef = useRef<HTMLIFrameElement>(null)
  const current =
    loaded && loaded.versionId === version.versionId ? loaded : null
  const sessionUrl = current?.sessionUrl ?? null

  useEffect(() => {
    let cancelled = false
    v2Api
      .openPreview(version.versionId)
      .then((result) => {
        if (cancelled) {
          // AC09：迟到的会话打开立即释放，避免泄漏
          void v2Api
            .closePreview(result.sid, version.versionId)
            .catch((error) => {
              console.error("预览会话释放失败", error)
            })
          return
        }
        setLoaded({
          versionId: version.versionId,
          sessionUrl: result.sessionUrl,
          sid: result.sid,
          error: "",
        })
        setNotice("")
      })
      .catch((err) => {
        if (!cancelled)
          setLoaded({
            versionId: version.versionId,
            sessionUrl: null,
            sid: "",
            error: err instanceof Error ? err.message : String(err),
          })
      })
    return () => {
      cancelled = true
    }
  }, [version.versionId])

  // AC09：会话生命周期——换版/卸载释放当前实例持有的会话（归属校验 sid+versionId）
  useEffect(() => {
    const owned = loaded
    return () => {
      if (owned?.sid)
        void v2Api.closePreview(owned.sid, owned.versionId).catch((error) => {
          console.error("预览会话释放失败", error)
        })
    }
  }, [loaded])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !sessionUrl) return
    const origin = new URL(sessionUrl, window.location.origin).origin
    frame.contentWindow?.postMessage(
      { type: "moon-preview-mode", mode },
      origin
    )
  }, [mode, sessionUrl])

  // AC22-二轮：加载完成即采集元素清单（宿主缓存供 Agent list_targets 消费）
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !sessionUrl) return
    const origin = new URL(sessionUrl, window.location.origin).origin
    frame.contentWindow?.postMessage({ type: "moon-preview-collect" }, origin)
  }, [sessionUrl, loaded?.error])

  // AC19-五轮：定位意图生命周期——意图绑定目标版本，桥就绪（ready）后可靠投递，
  // ok 确认/miss 失败即撤销；完成前不丢失（ready/onLoad 重试），换版本/卸载撤销过期意图；
  // 重复 ready/load 不重放已完成定位（用户返回首页不被旧意图拉回）。
  // AC19-七轮：定位请求由父层创建并持有（requestId 身份）；本阅读器只在
  // 「请求 pending + 绑定本会话版本」时投递，ok/miss 按身份回报，不自行派生请求。
  const requestRef = useRef<ReaderProps["focusRequest"]>(null)
  useEffect(() => {
    requestRef.current = focusRequest ?? null
  })
  const deliverRef = useRef<() => void>(() => {})
  useEffect(() => {
    deliverRef.current = () => {
      const request = requestRef.current
      const frame = frameRef.current
      if (
        !request ||
        request.status !== "pending" ||
        !frame ||
        !sessionUrl ||
        !loaded?.sid
      )
        return
      // 请求绑定目标版本——当前会话版本不符（父层已撤销/手动换版）则不投递
      if (request.versionId !== loaded.versionId) return
      const origin = new URL(sessionUrl, window.location.origin).origin
      frame.contentWindow?.postMessage(
        {
          type: "moon-preview-focus",
          requestId: request.requestId,
          target: request.target,
        },
        origin
      )
    }
  })
  // 请求 pending 时，ready/onLoad 驱动投递（完成前不丢失；完成后 status 终态不再投递）
  useEffect(() => {
    if (focusRequest?.status === "pending") deliverRef.current()
  }, [focusRequest])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // AC02：只接受当前预览会话 iframe 的消息——source 须为当前 frame 的
      // contentWindow，origin 须等于当前 sessionUrl 的预览 origin；比较视图双侧
      // 各自校验本实例会话，旧会话/同 URL 另一实例/非预期来源的迟到消息一律丢弃。
      const frame = frameRef.current
      if (!frame || !sessionUrl || event.source !== frame.contentWindow) return
      const expectedOrigin = new URL(sessionUrl, window.location.origin).origin
      if (event.origin !== expectedOrigin) return
      const data = event.data as {
        type?: unknown
        target?: unknown
        page?: unknown
        elements?: unknown
        reason?: unknown
        requestId?: unknown
      } | null
      // AC22-二轮：运行时元素清单回传 → 宿主缓存（归属 sid+versionId）
      if (data?.type === "moon-preview-inventory") {
        if (!loaded?.sid) return
        if (typeof data.page !== "string" || !Array.isArray(data.elements)) {
          setNotice("元素清单结构无效，未上报。")
          return
        }
        void v2Api
          .previewInventory({
            versionId: loaded.versionId,
            sid: loaded.sid,
            page: data.page,
            elements: data.elements,
          })
          .catch(() => {
            // AC22-三轮：上报失败不吞掉——显式呈现，不继续宣称清单能力
            setNotice("元素清单上报失败；预览将随下次加载重试。")
          })
        return
      }
      // AC22-三轮：桥就绪（每次页面加载触发）→ 立即下发模式与采集请求
      if (data?.type === "moon-preview-ready") {
        const origin = new URL(sessionUrl, window.location.origin).origin
        frame.contentWindow?.postMessage(
          { type: "moon-preview-mode", mode },
          origin
        )
        frame.contentWindow?.postMessage(
          { type: "moon-preview-collect" },
          origin
        )
        deliverRef.current()
        return
      }
      // AC19-七轮：定位回执按请求身份回报父层（requestId 匹配；身份不符/旧会话
      // 较早回执忽略；source/origin 拒绝边界保留）；终态由父层持有
      if (
        data?.type === "moon-preview-focus-ok" ||
        data?.type === "moon-preview-focus-miss"
      ) {
        const request = requestRef.current
        if (!request || data.requestId !== request.requestId) return
        if (data.type === "moon-preview-focus-miss") {
          onReport?.(
            request.requestId,
            "failed",
            data.reason === "page"
              ? "目标页面导航失败，无法定位。"
              : "目标元素在该页面不可定位。"
          )
        } else {
          onReport?.(request.requestId, "delivered")
        }
        return
      }
      if (data?.type === "moon-preview-notice") {
        setNotice("跨页定位记录读取失败，请重新点击意见。")
        return
      }
      if (data?.type !== "moon-preview-target" || mode !== "comment") return
      const target = (data?.target ?? null) as
        Record<string, unknown> | null | undefined
      // 目标结构契约（v2/preview.mjs 桥 describe 产出；service ui 分派依赖 page/tag）
      if (
        !target ||
        typeof target !== "object" ||
        Array.isArray(target) ||
        target.kind !== "ui" ||
        typeof target.page !== "string" ||
        target.page.length < 1 ||
        typeof target.tag !== "string" ||
        target.tag.length < 1
      )
        return
      onTargetSelect?.(target)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onTargetSelect, sessionUrl, loaded, onReport, mode])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-2 text-sm">
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(value) => {
            if (value === "experience" || value === "comment") setMode(value)
          }}
          aria-label="预览模式"
        >
          <ToggleGroupItem value="experience">体验</ToggleGroupItem>
          <ToggleGroupItem value="comment">评论</ToggleGroupItem>
        </ToggleGroup>
        {current?.error && (
          <span className="text-destructive">{current.error}</span>
        )}
        {notice && !current?.error && (
          <span className="text-muted-foreground">{notice}</span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {sessionUrl ? (
          <iframe
            ref={frameRef}
            src={sessionUrl}
            title="界面产物预览"
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={() => {
              // AC22-三轮：加载完成即重发模式与采集请求；未完成定位意图一并尝试投递
              const frame = frameRef.current
              if (frame && sessionUrl) {
                const origin = new URL(sessionUrl, window.location.origin)
                  .origin
                frame.contentWindow?.postMessage(
                  { type: "moon-preview-mode", mode },
                  origin
                )
                frame.contentWindow?.postMessage(
                  { type: "moon-preview-collect" },
                  origin
                )
                deliverRef.current()
              }
            }}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {current?.error || "正在打开预览会话…"}
          </p>
        )}
      </div>
    </div>
  )
}
