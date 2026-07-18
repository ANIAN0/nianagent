"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

/**
 * 对话滚动：对齐 open-agents 的 `useScrollToBottom`，
 * 而不是 ai-elements 默认的 `use-stick-to-bottom` spring。
 *
 * 原因：stick-to-bottom 在局部 UI 重排（审批单选、展开说明等）时会把内容滚出视口，
 * 表现为中间大片空白、顶栏与输入框仍在。open-agents 只在「用户已在底部」时
 * 用 scrollTop 跟随内容增高，交互稳定。
 */

type ConversationScrollApi = {
  readonly isAtBottom: boolean;
  readonly scrollToBottom: () => void;
  readonly setIsAtBottom: (value: boolean) => void;
  readonly bindScrollToBottom: (fn: () => void) => void;
};

const ConversationScrollContext = createContext<ConversationScrollApi | null>(
  null,
);

function useConversationScroll(): ConversationScrollApi {
  const ctx = useContext(ConversationScrollContext);
  if (!ctx) {
    throw new Error(
      "ConversationScrollButton / ConversationContent 必须放在 Conversation 内部使用",
    );
  }
  return ctx;
}

export type ConversationProps = ComponentProps<"div">;

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollImplRef = useRef<() => void>(() => {});

  const scrollToBottom = useCallback(() => {
    scrollImplRef.current();
  }, []);

  const bindScrollToBottom = useCallback((fn: () => void) => {
    scrollImplRef.current = fn;
  }, []);

  const api = useMemo<ConversationScrollApi>(
    () => ({
      isAtBottom,
      scrollToBottom,
      setIsAtBottom,
      bindScrollToBottom,
    }),
    [isAtBottom, scrollToBottom, bindScrollToBottom],
  );

  return (
    <ConversationScrollContext.Provider value={api}>
      <div
        className={cn("relative min-h-0 flex-1 overflow-hidden", className)}
        role="log"
        {...props}
      >
        {children}
      </div>
    </ConversationScrollContext.Provider>
  );
};

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  children,
  ...props
}: ConversationContentProps) => {
  const { setIsAtBottom, bindScrollToBottom } = useConversationScroll();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight;
    };
    bindScrollToBottom(scrollToBottom);

    const handleScroll = () => {
      const threshold = 10;
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        threshold;
      if (isAtBottomRef.current !== atBottom) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    // 初次挂载贴底
    scrollToBottom();
    handleScroll();

    // 仅在用户已在底部时跟随内容增高（流式输出、新消息）
    const resizeObserver = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        scrollToBottom();
      }
    });
    resizeObserver.observe(container);
    const content = contentRef.current;
    if (content) {
      resizeObserver.observe(content);
    }

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [bindScrollToBottom, setIsAtBottom]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-auto"
      style={{ scrollbarGutter: "stable both-edges" }}
    >
      <div
        ref={contentRef}
        className={cn("flex flex-col gap-8 p-4", className)}
        {...props}
      >
        {children}
      </div>
    </div>
  );
};

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useConversationScroll();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }

  return (
    <Button
      className={cn(
        "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
        className,
      )}
      onClick={handleScrollToBottom}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number,
  ) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className,
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
