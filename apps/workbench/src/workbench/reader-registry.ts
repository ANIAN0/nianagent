// 三类内容 Reader 注册（T08/T15）：工作台壳按 kind 经本注册表取得阅读器，
// 各类型阅读器互不依赖；未注册类型显式呈现"未接入"，不留静默空窗。
import type { ComponentType, RefObject } from "react"
import { MarkdownReader } from "./readers/markdown"
import { BoardReader } from "./readers/board"
import { UiReader } from "./readers/ui"
import type { BoardCanvas, V2Block, V2Thread } from "./v2-api"

export type ReaderVersion = {
  versionId: string
  sequence: number
  kind: string
  blocks?: V2Block[]
  canvas?: BoardCanvas
  manifest?: { routes: Record<string, string> }
}

/** AC19-七轮：定位请求由父层（工作台壳）创建并持有——requestId 为不可变请求身份，
 * status 终态（delivered/failed/cancelled）由回执/取消消费；阅读器只执行投递与报告，
 * 不自行派生或重置请求。 */
export type ReaderFocusRequest = {
  requestId: string
  versionId: string
  status: "pending" | "delivered" | "failed" | "cancelled"
  message?: string
  target: {
    objectId?: string
    page?: string
    tag?: string
    id?: string
    text?: string
  }
}

export type ReaderProps = {
  version: ReaderVersion
  /** 当前版本线程（用于锚点高亮）。 */
  threads: V2Thread[]
  /** 容器引用：划选评论与资源加载按容器定位（划选类阅读器使用）。 */
  containerRef: RefObject<HTMLDivElement | null>
  /** 鼠标选择结束（容器内冒泡）。 */
  onSelect: () => void
  /** 对象类阅读器（白板/UI）点击目标回调；target 形状随类型契约。 */
  onTargetSelect?: (target: Record<string, unknown>) => void
  /** AC19-七轮：父层持有的定位请求（requestId 身份；pending 时由阅读器投递并回报）。 */
  focusRequest?: ReaderFocusRequest | null
  /** 定位结果按请求身份回报（delivered/failed）；身份不符的回执由阅读器丢弃。 */
  onReport?: (
    requestId: string,
    outcome: "delivered" | "failed",
    message?: string
  ) => void
}

export const kindLabel = (kind: string) =>
  kind === "markdown"
    ? "文档"
    : kind === "board"
      ? "白板"
      : kind === "ui"
        ? "界面"
        : kind

const readers: Partial<Record<string, ComponentType<ReaderProps>>> = {
  markdown: MarkdownReader,
  board: BoardReader,
  ui: UiReader,
}

export const readerFor = (kind: string): ComponentType<ReaderProps> | null =>
  readers[kind] ?? null
