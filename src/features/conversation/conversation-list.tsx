import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller"
import { ConversationNavigator } from "./conversation-navigator"
import "./conversation-layout.css"

export interface ConversationListItem {
  id: string
  content: ReactNode
  revision?: string | number
  turn?: number
  prompt?: string
  response?: string
}
export interface ConversationReadingPosition {
  anchorId: string
  offset: number
  following: boolean
}
export interface ConversationListProps {
  items: readonly ConversationListItem[]
  initialPosition?: ConversationReadingPosition
  onPositionChange?: (position: ConversationReadingPosition) => void
}

function ConversationListContent({
  items,
  initialPosition,
  onPositionChange,
}: ConversationListProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const [savedPosition] = useState(initialPosition)
  const { scrollToMessage, scrollToEnd } = useMessageScroller()
  const { currentAnchorId } = useMessageScrollerVisibility()
  const turns = useMemo(
    () =>
      items
        .filter((item) => item.turn !== undefined)
        .map((item) => ({
          id: item.id,
          turn: item.turn!,
          prompt: item.prompt ?? "",
          response: item.response,
        })),
    [items]
  )
  // Restore the saved reading anchor once. Follow/streaming and resize anchoring
  // remain owned by the official MessageScroller provider.
  useLayoutEffect(() => {
    if (!savedPosition || savedPosition.following) return
    const frame = requestAnimationFrame(() => {
      const restored = scrollToMessage(savedPosition.anchorId, {
        align: "start",
        behavior: "auto",
        scrollMargin: savedPosition.offset - 16,
      })
      if (!restored) scrollToEnd({ behavior: "auto" })
    })
    return () => cancelAnimationFrame(frame)
  }, [savedPosition, scrollToMessage, scrollToEnd])

  function capture() {
    const element = viewport.current
    if (!element) return
    const top = element.getBoundingClientRect().top
    const row = Array.from(
      element.querySelectorAll<HTMLElement>("[data-message-id]")
    ).find((candidate) => candidate.getBoundingClientRect().bottom > top)
    if (!row?.dataset.messageId) return
    onPositionChange?.({
      anchorId: row.dataset.messageId,
      offset: row.getBoundingClientRect().top - top,
      following:
        element.scrollHeight - element.scrollTop - element.clientHeight <= 8,
    })
  }

  return (
    <div className="conversation-list">
      <MessageScroller className="conversation-scroller">
        <MessageScrollerViewport
          ref={viewport}
          aria-label="会话消息"
          onScroll={capture}
        >
          <MessageScrollerContent className="conversation-rows" aria-live="off">
            {items.map((item) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={item.turn !== undefined}
                className="conversation-row"
              >
                {item.content}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="回到最新消息" title="回到最新消息" />
      </MessageScroller>
      <ConversationNavigator
        items={turns}
        activeId={currentAnchorId ?? turns[0]?.id}
        onNavigate={(id) => {
          scrollToMessage(id, {
            align: "start",
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            scrollMargin: 0,
          })
        }}
      />
    </div>
  )
}

export function ConversationList(props: ConversationListProps) {
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition={
        props.initialPosition && !props.initialPosition.following
          ? "start"
          : "end"
      }
      scrollPreviousItemPeek={0}
      scrollMargin={0}
    >
      <ConversationListContent {...props} />
    </MessageScrollerProvider>
  )
}
