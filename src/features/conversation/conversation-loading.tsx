import { Skeleton } from "@/components/ui/skeleton"

export function ConversationLoading() {
  return (
    <div
      role="status"
      aria-label="正在读取会话"
      className="mx-auto flex w-full max-w-[780px] flex-col gap-9 px-4 py-8"
    >
      <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
      <div className="flex w-4/5 flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </div>
  )
}
