import {
  CircleCheck,
  CircleAlert,
  CircleSlash,
  Braces,
  LoaderCircle,
  Trash2,
} from "lucide-react"
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
      : response.status === "error"
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
                response.status === "idle" || response.status === "running"
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
          取消不保证已提交的操作回滚；写入结果不确定时，请先读取当前状态。
        </p>
      )}
      {response.status === "error" && (
        <p className="api-response-note">
          错误来自正式请求。根据接口说明修正参数或运行环境后重试。
        </p>
      )}
    </section>
  )
}
