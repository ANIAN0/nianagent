import {
  ChevronDown,
  FileCode2,
  FilePenLine,
  FilePlus2,
  Terminal,
  Wrench,
} from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import type { ConversationToolCall } from "../conversation-types"
import { CopyButton } from "./copy-button"
import {
  useMessageDisclosure,
  useMessageEnvironment,
} from "./message-environment"
import { MessageAttachments } from "./message-attachments"
import { useFilePreview } from "./use-file-preview"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { ToolResultPresentation } from "@/features/extensions/tool-result-presentation"
import "./messages.css"

const labels = {
  running: "执行中",
  success: "成功",
  failed: "失败",
  stopped: "已停止",
  "not-run": "未执行",
}
const kinds = {
  read: { label: "读取文件", icon: FileCode2 },
  edit: { label: "修改文件", icon: FilePenLine },
  write: { label: "写入文件", icon: FilePlus2 },
  bash: { label: "运行命令", icon: Terminal },
  powershell: { label: "运行命令", icon: Terminal },
}
const formatDuration = (ms: number) =>
  ms < 1000
    ? String(Math.round(ms)) + " 毫秒"
    : String(Math.round(ms / 100) / 10) + " 秒"
function inputTarget(tool: ConversationToolCall) {
  try {
    const input: unknown = JSON.parse(tool.input || "{}")
    if (input && typeof input === "object") {
      const value = input as Record<string, unknown>
      return typeof value.path === "string"
        ? value.path
        : typeof value.command === "string"
          ? value.command
          : ""
    }
  } catch {
    /* Old history can contain plain text parameters. */
  }
  return ""
}

export function ToolCall({
  tool,
  defaultOpen = false,
  occurrenceId,
  awaitingApproval = false,
}: {
  tool: ConversationToolCall
  defaultOpen?: boolean
  occurrenceId?: string
  awaitingApproval?: boolean
}) {
  const environment = useMessageEnvironment()
  // Display block identity remains stable when Pi assigns a durable entryId.
  // tool.occurrenceId is authority metadata, not the streaming disclosure key.
  const occurrence = occurrenceId ?? tool.occurrenceId ?? tool.id
  const [open, setOpen] = useMessageDisclosure(occurrence, "tool", defaultOpen)
  const [parameters, setParameters] = useMessageDisclosure(
    occurrence,
    "parameters"
  )
  const [full, setFull] = useMessageDisclosure(occurrence, "full-result")
  const known = kinds[tool.name as keyof typeof kinds]
  const Icon = known?.icon ?? Wrench
  const command = tool.name === "bash" || tool.name === "powershell"
  const status =
    tool.status === "success" &&
    tool.exitCode !== undefined &&
    tool.exitCode !== 0
      ? "failed"
      : tool.status
  const label = awaitingApproval
    ? "等待确认"
    : command && status === "success" && tool.exitCode === undefined
      ? "已返回"
      : labels[status]
  const object =
    tool.target?.displayPath || tool.target?.command || inputTarget(tool)
  const firstError =
    status === "failed"
      ? tool.result?.split("\n").find((line) => line.trim())
      : undefined
  const lines = tool.result?.split("\n") ?? []
  const diff = status === "success" ? tool.details?.diff : undefined
  const file =
    tool.artifact?.path ??
    (tool.target?.kind === "file" ? tool.target.path : undefined)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="conversation-tool"
      data-status={awaitingApproval ? "waiting" : status}
      data-tool-kind={tool.name}
    >
      <CollapsibleTrigger
        className="conversation-process-trigger"
        aria-label={(known?.label ?? tool.name) + " " + object + "，" + label}
      >
        <Icon aria-hidden />
        <strong className="conversation-tool-name" title={tool.name}>
          {known?.label ?? tool.name}
        </strong>
        {object && (
          <span className="conversation-tool-target" title={object}>
            {object}
          </span>
        )}
        {!known && (
          <span className="conversation-tool-source" title={tool.source}>
            {tool.source}
          </span>
        )}
        {tool.target?.line !== undefined && (
          <span className="conversation-tool-range">
            {tool.target.line}
            {tool.target.lineCount
              ? "–" + (tool.target.line + tool.target.lineCount - 1)
              : ""}{" "}
            行
          </span>
        )}
        <span className="conversation-tool-status">
          <span aria-hidden />
          {label}
        </span>
        <ChevronDown className="conversation-disclosure-chevron" aria-hidden />
      </CollapsibleTrigger>
      {!open && firstError && (
        <div className="conversation-tool-error-summary" title={firstError}>
          {firstError}
        </div>
      )}
      <CollapsibleContent>
        <div className="conversation-tool-detail">
          {command && (
            <dl className="conversation-tool-context">
              <dt>执行目录</dt>
              <dd title={tool.target?.cwd}>{tool.target?.cwd || "未记录"}</dd>
            </dl>
          )}
          <div className="conversation-tool-result-header">
            <strong>{diff ? "文件变更" : command ? "命令输出" : "结果"}</strong>
            <CopyButton
              text={diff || tool.result || ""}
              label={diff ? "复制差异" : "复制工具结果"}
            />
          </div>
          {diff ? (
            <ToolDiff
              diff={diff}
              firstChangedLine={tool.details?.firstChangedLine}
            />
          ) : (
            <ToolResultPresentation
              tool={tool}
              fallback={
                <div className="conversation-tool-output">
                  {tool.result
                    ? full
                      ? tool.result
                      : lines.slice(0, 20).join("\n")
                    : status === "running"
                      ? "等待工具结果…"
                      : status === "not-run"
                        ? "此调用未执行。"
                        : status === "stopped"
                          ? "执行已停止，未返回结果。"
                          : "此记录未保存结果内容。"}
                </div>
              }
            />
          )}
          {!diff && lines.length > 20 && (
            <Button
              variant="link"
              size="xs"
              aria-expanded={full}
              onClick={() => setFull(!full)}
            >
              {full
                ? "收起已保存内容"
                : "展开已保存内容（" + lines.length + " 行）"}
            </Button>
          )}
          {tool.resultTruncated && (
            <p className="conversation-result-note">
              工具结果已截断
              {tool.resultLength !== undefined
                ? "（原始 " + tool.resultLength.toLocaleString() + " 字符）"
                : ""}
              ，这里只显示已保存内容。
            </p>
          )}
          {status === "success" && file && environment?.onOpenPath && (
            <ToolArtifact
              path={file}
              name={
                tool.artifact?.displayPath || tool.target?.displayPath || file
              }
              operation={tool.artifact?.operation}
            />
          )}
          {!!tool.images?.length && (
            <MessageAttachments
              cwd={environment?.cwd}
              attachments={tool.images.map((image) => ({
                ...image,
                kind: "image" as const,
                materialType: "image" as const,
              }))}
              onOpenAttachment={environment?.onOpenAttachment}
            />
          )}
          {(tool.exitCode !== undefined ||
            tool.durationMs !== undefined ||
            (command && status !== "running" && status !== "not-run")) && (
            <dl className="conversation-tool-metrics">
              {(tool.exitCode !== undefined || command) && (
                <div>
                  <dt>退出码</dt>
                  <dd>{tool.exitCode ?? "未提供"}</dd>
                </div>
              )}
              {tool.durationMs !== undefined && (
                <div>
                  <dt>耗时</dt>
                  <dd>{formatDuration(tool.durationMs)}</dd>
                </div>
              )}
            </dl>
          )}
          <Collapsible
            open={parameters}
            onOpenChange={setParameters}
            className="conversation-tool-parameters"
          >
            <CollapsibleTrigger className="conversation-detail-trigger">
              <ChevronDown
                className="conversation-disclosure-chevron"
                aria-hidden
              />
              原始参数{tool.input === undefined && <span>未记录</span>}
            </CollapsibleTrigger>
            <CollapsibleContent className="conversation-detail-content">
              <pre>{tool.input ?? "此记录未提供输入参数。"}</pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolDiff({
  diff,
  firstChangedLine,
}: {
  diff: string
  firstChangedLine?: number
}) {
  return (
    <div
      className="conversation-tool-diff"
      role="region"
      aria-label="实际文件差异"
      tabIndex={0}
    >
      {firstChangedLine !== undefined && (
        <span className="conversation-result-note">
          首处修改：第 {firstChangedLine} 行
        </span>
      )}
      <pre>
        {diff.split("\n").map((line, index) => (
          <span
            key={index}
            data-diff={
              /^\+(?!\+\+)/.test(line)
                ? "added"
                : /^-(?!--)/.test(line)
                  ? "removed"
                  : "context"
            }
          >
            {line || "\u00a0"}
          </span>
        ))}
      </pre>
    </div>
  )
}

function ToolArtifact({
  path,
  name,
  operation,
}: {
  path: string
  name: string
  operation?: "create" | "overwrite" | "write" | "edit"
}) {
  const { pending, issue, open, onSettings } = useFilePreview(path)
  return (
    <div className="conversation-tool-artifact-control">
      <Button
        variant="outline"
        size="sm"
        className="conversation-tool-artifact"
        title={path}
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          void open()
        }}
      >
        <FileCode2 aria-hidden />
        <span>
          {operation === "create"
            ? "已生成"
            : operation === "edit"
              ? "已修改"
              : operation === "overwrite"
                ? "已覆盖"
                : operation === "write"
                  ? "已写入"
                  : "预览文件"}{" "}
          · {name}
        </span>
      </Button>
      {issue && (
        <div className="conversation-inline-file-error" role="status">
          {issue.message}
          <RecoveryAction
            issue={issue}
            onRetry={() => {
              void open()
            }}
            onReload={() => {
              void open()
            }}
            onCheck={() => {
              void open()
            }}
            onSettings={onSettings}
            disabled={pending}
            labels={{
              retry: "重试预览",
              reload: "重新读取文件",
              check: "核对文件",
            }}
          />
        </div>
      )}
    </div>
  )
}
