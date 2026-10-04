import {
  CircleCheck,
  CircleAlert,
  CircleSlash,
  Braces,
  LoaderCircle,
  Trash2,
} from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { CopyButton } from "./copy-button"
import type { CatalogResponse } from "./types"

const statusLabels = {
  idle: "尚未执行",
  running: "请求中",
  success: "调用成功",
  error: "调用失败",
  unknown: "结果待确认",
  cancelled: "已取消等待",
} as const

function elapsedLabel(milliseconds: number) {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`
}

export function ResponseViewer({
  response,
  onClear,
}: {
  response: CatalogResponse
  onClear?: () => void
}) {
  const Icon =
    response.status === "success"
      ? CircleCheck
      : response.status === "error" || response.status === "unknown"
        ? CircleAlert
        : response.status === "cancelled"
          ? CircleSlash
          : response.status === "running"
            ? LoaderCircle
            : Braces
  return (
    <section
      className="api-response-panel"
      aria-label="接口响应"
      data-status={response.status}
    >
      <div className="api-panel-heading">
        <div className="api-response-heading">
          <h3>响应结果</h3>
          <Badge
            variant={response.status === "error" ? "destructive" : "secondary"}
            className={
              response.status === "unknown" ? "text-status-warning" : undefined
            }
          >
            <Icon
              className={
                response.status === "running" ? "animate-spin" : undefined
              }
            />
            {statusLabels[response.status]}
          </Badge>
        </div>
        <div className="api-response-actions">
          <CopyButton
            value={response.text}
            label="复制结果"
            disabled={response.status === "running"}
          />
          {onClear && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="清空响应结果"
              disabled={
                response.status === "idle" ||
                response.status === "running" ||
                !!response.receiptInput ||
                !!response.queueReceiptInput ||
                !!response.authorizationInput
              }
              onClick={onClear}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <div className="api-response-status" aria-live="polite">
        {statusLabels[response.status]}
        {response.elapsedMs !== undefined &&
          Number.isFinite(response.elapsedMs) &&
          response.elapsedMs >= 0 && (
            <span>耗时 {elapsedLabel(response.elapsedMs)}</span>
          )}
      </div>
      {response.issue && (
        <OperationFeedback
          title={
            response.status === "unknown" ? "调用结果尚未确认" : "调用未完成"
          }
          {...response.issue}
          actions={<RecoveryAction issue={response.issue} />}
        />
      )}
      {response.receiptInput && (
        <div className="flex flex-col gap-2 py-3">
          <p className="text-sm">
            使用“写入回执”接口核对原请求，参数如下。不会重复执行原写入。
          </p>
          <pre className="api-response-output moon-scrollbar">
            {JSON.stringify(response.receiptInput, null, 2)}
          </pre>
          <div>
            <CopyButton
              value={JSON.stringify(response.receiptInput, null, 2)}
              label="复制回执查询参数"
            />
          </div>
        </div>
      )}
      {response.authorizationInput && (
        <div className="flex flex-col gap-2 py-3">
          <p className="text-sm">
            使用“查询授权任务”或“取消授权”接口处理原任务，两者使用相同参数。不会再次启动授权。
          </p>
          <pre className="api-response-output moon-scrollbar">
            {JSON.stringify(response.authorizationInput, null, 2)}
          </pre>
          <div>
            <CopyButton
              value={JSON.stringify(response.authorizationInput, null, 2)}
              label="复制原授权任务参数"
            />
          </div>
        </div>
      )}
      {response.queueReceiptInput && (
        <div className="flex flex-col gap-2 py-3">
          <p className="text-sm">
            使用“核对原队列操作”（conversationQueueReceiptRead）接口读取下方原会话和原请求编号。该查询不修改队列，也不会再次交付消息；未查到回执仍表示结果待确认。
          </p>
          <pre className="api-response-output moon-scrollbar">
            {JSON.stringify(response.queueReceiptInput, null, 2)}
          </pre>
          <div>
            <CopyButton
              value={JSON.stringify(response.queueReceiptInput, null, 2)}
              label="复制原队列回执查询参数"
            />
          </div>
        </div>
      )}
      {response.status === "idle" || response.status === "running" ? (
        <Empty className="api-response-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon
                className={
                  response.status === "running" ? "animate-spin" : undefined
                }
              />
            </EmptyMedia>
            <EmptyTitle>
              {response.status === "running"
                ? "正在等待服务响应"
                : "尚未发送请求"}
            </EmptyTitle>
            <EmptyDescription>
              {response.status === "running"
                ? "可取消当前等待；返回结果会显示在这里。"
                : "浏览文档不会调用服务。检查参数后主动执行。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <pre
          className="api-response-output moon-scrollbar"
          tabIndex={0}
          aria-label="响应正文"
        >
          {response.text ||
            (response.status === "cancelled"
              ? "已取消当前请求。"
              : "服务返回空结果。")}
        </pre>
      )}
      {response.status === "cancelled" && (
        <p className="api-cancel-note">
          取消不保证已提交的操作回滚；未核对前不要重复执行，新的操作可能产生额外费用或外部影响。
        </p>
      )}
      {response.status === "error" && (
        <p className="api-response-note">
          错误来自正式请求。根据接口说明修正参数或运行环境后重试。
        </p>
      )}
      {response.status === "unknown" && (
        <p className="api-response-note">
          未能确认此次操作的最终结果。先核对原操作，勿将重复执行当作结果确认；新的操作可能产生额外费用或外部影响。
        </p>
      )}
    </section>
  )
}
