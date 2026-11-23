import {
  useLayoutEffect,
  useCallback,
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

const HISTORY_TOP_PADDING = 16

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
  restoringPosition,
  onRestored,
}: ConversationListProps & {
  restoringPosition: boolean
  onRestored: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const restoring = useRef(
    Boolean(initialPosition && !initialPosition.following)
  )
  const captureFrame = useRef<number | undefined>(undefined)
  const navigationFrame = useRef(0)
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
  const latestTurnId = turns.at(-1)?.id
  const previousTurnId = useRef(latestTurnId)
  useLayoutEffect(() => {
    const previous = previousTurnId.current
    previousTurnId.current = latestTurnId
    if (!previous || !latestTurnId || previous === latestTurnId) return
    // Replacing a pending submission can keep the row count unchanged.
    // Wait for the scroller's child-list observer before anchoring the new turn.
    const frame = requestAnimationFrame(() => {
      scrollToMessage(latestTurnId, {
        align: "start",
        behavior: "auto",
        scrollMargin: 0,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [latestTurnId, scrollToMessage])

  function navigateToTurn(id: string) {
    cancelAnimationFrame(navigationFrame.current)
    const jump = () =>
      scrollToMessage(id, { align: "start", behavior: "auto", scrollMargin: 0 })
    jump()
    navigationFrame.current = requestAnimationFrame(() => {
      // The first jump reveals offscreen rows and replaces their estimated heights.
      jump()
      navigationFrame.current = requestAnimationFrame(jump)
    })
  }
  useLayoutEffect(() => () => cancelAnimationFrame(navigationFrame.current), [])
  // Restore the saved reading anchor once. Follow/streaming and resize anchoring
  // remain owned by the official MessageScroller provider.
  useLayoutEffect(() => {
    if (!initialPosition || initialPosition.following) return
    let settleFrame = 0
    const restore = () => {
      const restored = scrollToMessage(initialPosition.anchorId, {
        align: "start",
        behavior: "auto",
        scrollMargin: initialPosition.offset - HISTORY_TOP_PADDING,
      })
      if (!restored) scrollToEnd({ behavior: "auto" })
    }
    restore()
    const frame = requestAnimationFrame(() => {
      restore()
      // content-visibility may replace an estimated height after the first
      // jump. Reapply the same official anchor before publishing a position.
      settleFrame = requestAnimationFrame(() => {
        restore()
        restoring.current = false
        onRestored()
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(settleFrame)
    }
  }, [initialPosition, scrollToMessage, scrollToEnd, onRestored])

  const captureNow = useCallback(() => {
    if (restoring.current) return
    const element = viewport.current
    if (!element) return
    const rows = content.current?.children
    if (!rows) return
    const top = element.getBoundingClientRect().top
    // MessageScrollerContent renders ordered, non-overlapping rows with
    // its spacer last. Find the first row crossing the viewport top.
    let low = 0
    let high = rows.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (rows[middle].getBoundingClientRect().bottom > top) high = middle
      else low = middle + 1
    }
    const row = rows[low] as HTMLElement | undefined
    if (!row?.dataset.messageId) return
    onPositionChange?.({
      anchorId: row.dataset.messageId,
      offset: row.getBoundingClientRect().top - top,
      following:
        element.scrollHeight - element.scrollTop - element.clientHeight <= 8,
    })
  }, [onPositionChange])
  function capture() {
    if (restoring.current || captureFrame.current !== undefined) return
    captureFrame.current = requestAnimationFrame(() => {
      captureFrame.current = undefined
      captureNow()
    })
  }
  useLayoutEffect(
    () => () => {
      if (captureFrame.current !== undefined) {
        cancelAnimationFrame(captureFrame.current)
        captureFrame.current = undefined
        captureNow()
      }
    },
    [captureNow]
  )

  return (
    <div className="conversation-list">
      <ConversationNavigator
        items={turns}
        activeId={currentAnchorId ?? turns[0]?.id}
        onNavigate={navigateToTurn}
      />
      <MessageScroller className="conversation-scroller">
        <MessageScrollerViewport
          ref={viewport}
          className={restoringPosition ? "invisible" : undefined}
          aria-label="会话消息"
          onScroll={capture}
        >
          <MessageScrollerContent
            ref={content}
            className="conversation-rows"
            aria-live="off"
          >
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
    </div>
  )
}

export function ConversationList({
  initialPosition,
  ...props
}: ConversationListProps) {
  const [savedPosition] = useState(initialPosition)
  const [restoringPosition, setRestoringPosition] = useState(
    !!savedPosition && !savedPosition.following
  )
  const onRestored = useCallback(() => setRestoringPosition(false), [])
  return (
    <MessageScrollerProvider
      autoScroll={!restoringPosition}
      defaultScrollPosition={
        savedPosition && !savedPosition.following ? "start" : "end"
      }
      scrollPreviousItemPeek={0}
      scrollMargin={HISTORY_TOP_PADDING}
    >
      <ConversationListContent
        {...props}
        initialPosition={savedPosition}
        restoringPosition={restoringPosition}
        onRestored={onRestored}
      />
    </MessageScrollerProvider>
  )
}
