import { useEffect, useRef, useState } from "react"
import { ChevronDown, FolderOpen } from "lucide-react"
import type {
  StartupFailureStage,
  StartupIssue,
  StartupPhase,
} from "@/contracts/desktop.generated"
import { StatusMessage } from "@/components/feedback/status-message"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { StartupView } from "./startup-service"

export type StartupAction =
  | "choose"
  | "prepare"
  | "fresh"
  | "start"
  | "retry"
  | "continue"
  | "diagnostics"
  | "exit"
  | "refresh"
const phases: Record<StartupPhase, string> = {
  awaitingConfirmation: "等待选择数据",
  preparing: "正在检查目录与运行环境",
  ready: "目录检查完成",
  inspecting: "正在检查已有数据",
  copying: "正在复制数据",
  validating: "正在核验复制结果",
  committing: "正在启用新的数据目录",
  readyToOpen: "复制与核验已完成",
  failed: "迁移未完成",
}
const stages: Record<StartupFailureStage, string> = {
  runtime: "运行环境检查",
  target: "目标目录检查",
  source: "原目录检查",
  inspecting: "数据检查",
  copying: "数据复制",
  validating: "数据核验",
  committing: "启用新目录",
  opening: "启动 Moon",
}
const working: StartupPhase[] = [
  "preparing",
  "inspecting",
  "copying",
  "validating",
  "committing",
]
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
function advice(issue: StartupIssue, fresh: boolean) {
  if (issue.stage === "opening")
    return fresh
      ? "新的数据目录已启用。请检查本次记录后尝试启动，或退出后重新打开 Moon。"
      : "旧数据已导入。请检查本次记录后尝试启动，或退出后重新打开 Moon。"
  switch (issue.code) {
    case "runtimeMissing":
    case "dependencyMissing":
    case "runtimeIncompatible":
      return "请使用运行资源完整的 Moon 版本后重新启动。"
    case "sourceBusy":
      return "请退出其他 Moon 窗口或仍在使用原数据的程序，再重新检查。"
    case "targetInvalid":
      return "请选择新建或空的 Moon 专用目录。"
    case "permission":
      return "请检查相关目录的读取与写入权限，或选择可以写入的新目录。"
    case "insufficientSpace":
      return "请释放目标磁盘空间，或选择空间充足的新目录。"
    case "planExpired":
      return "请重新检查目录后继续。"
    case "sourceInvalid":
    case "dataInvalid":
      return "请保留原数据，并打开记录目录查看本次诊断。"
    case "storageIo":
    case "interrupted":
    case "internal":
      return "请保留原数据，检查本次记录后按可用操作继续。"
  }
}
function IssueDetails({ issue }: { issue: StartupIssue }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="xs">
          {open ? "收起详情" : "查看详情"}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 flex flex-col gap-2 text-xs leading-5">
          <div>
            <dt className="text-muted-foreground">失败阶段</dt>
            <dd>{stages[issue.stage]}</dd>
          </div>
          {issue.path && (
            <div>
              <dt className="text-muted-foreground">相关位置</dt>
              <dd className="[overflow-wrap:anywhere] select-text">
                {issue.path}
              </dd>
            </div>
          )}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}
export function StartupMigrationView({
  view,
  target,
  planValid,
  expired,
  pending,
  onTargetChange,
  onAction,
}: {
  view: StartupView
  target: string
  planValid: boolean
  expired: boolean
  pending: StartupAction | null
  onTargetChange: (value: string) => void
  onAction: (action: StartupAction) => void
}) {
  const snapshot = view.snapshot
  const fresh = snapshot?.selection === "fresh"
  const busy = pending !== null
  const connected = view.listening && view.issue === null
  const running = !!snapshot && working.includes(snapshot.phase)
  const committed = snapshot?.phase === "readyToOpen"
  const failed = snapshot?.phase === "failed"
  const issue = snapshot?.issue
  // 目标的磁盘信息属于已检查计划；编辑/过期后只保留仍属原目录的数据规模。
  const availableBytes =
    snapshot &&
    target === snapshot.targetDirectory &&
    (planValid || running || committed)
      ? snapshot.availableBytes
      : null
  const statistics = snapshot
    ? [
        !fresh && snapshot.fileCount !== null
          ? `${snapshot.fileCount} 个文件`
          : null,
        !fresh && snapshot.totalBytes !== null
          ? formatBytes(snapshot.totalBytes)
          : null,
        availableBytes !== null
          ? `目标磁盘可用 ${formatBytes(availableBytes)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""
  const heading = useRef<HTMLHeadingElement>(null)
  const editable =
    !!snapshot?.capabilities.prepare &&
    connected &&
    !busy &&
    !running &&
    !committed
  const retry =
    !!snapshot?.capabilities.retry &&
    !!snapshot.operationId &&
    !!issue?.retryable &&
    target === snapshot.targetDirectory
  const primary: StartupAction = committed
    ? "continue"
    : retry
      ? "retry"
      : fresh
        ? "fresh"
        : planValid
          ? "start"
          : "prepare"
  const primaryAllowed =
    !!snapshot &&
    connected &&
    !busy &&
    (primary === "continue"
      ? snapshot.capabilities.continueStartup
      : primary === "retry"
        ? retry
        : primary === "start"
          ? snapshot.capabilities.migrate
          : primary === "fresh"
            ? !!target.trim() &&
              (snapshot.capabilities.prepare ||
                (planValid && snapshot.capabilities.createFresh))
            : snapshot.capabilities.prepare && !!target.trim())
  const freshAllowed =
    !!snapshot &&
    connected &&
    !busy &&
    !running &&
    !committed &&
    !!target.trim() &&
    (snapshot.capabilities.prepare ||
      (planValid && snapshot.capabilities.createFresh))
  const hasActions =
    !!snapshot?.capabilities.exit ||
    (!!issue && !!snapshot?.capabilities.openDiagnostics) ||
    !!view.issue?.retryable ||
    (!!snapshot && (!view.listening || !running))
  const title = committed
    ? issue?.stage === "opening"
      ? fresh
        ? "新数据集已建立，启动需要处理"
        : "数据已迁移，启动需要处理"
      : fresh
        ? "新数据集已建立，正在启动 Moon"
        : "旧数据已导入，正在启动 Moon"
    : snapshot?.phase === "preparing"
      ? "正在检查数据目录"
      : failed
        ? fresh
          ? "新数据目录尚未启用"
          : "导入未完成"
        : running
          ? fresh
            ? "正在启用新的 Moon 数据目录"
            : "正在导入 Moon 数据"
          : snapshot?.selection === "import"
            ? "导入已有 Moon 数据"
            : "选择 Moon 的启动数据"
  useEffect(() => {
    if (failed || issue?.stage === "opening") heading.current?.focus()
  }, [failed, issue?.stage, issue?.code])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <section
        aria-labelledby="startup-title"
        className="my-auto flex w-full max-w-[560px] flex-col gap-6 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10"
      >
        <header className="flex flex-col gap-2">
          <h1
            ref={heading}
            tabIndex={-1}
            id="startup-title"
            className="text-base leading-6 font-semibold outline-none"
          >
            {title}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {committed
              ? fresh
                ? "新的数据目录已启用，旧文件保留。Moon 将使用新的数据集继续启动。"
                : "旧数据已复制并核验，原副本保留。Moon 将在新目录中继续启动。"
              : "可以导入已有会话、设置和草稿，也可以不导入，使用新的数据集启动。两种选择都会保留旧文件。"}
          </p>
        </header>
        {snapshot ? (
          <>
            <dl className="flex flex-col gap-3 text-[13px] leading-5">
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">已有数据</dt>
                <dd className="[overflow-wrap:anywhere] select-text">
                  {snapshot.sourceDirectory}
                </dd>
              </div>
              {snapshot.legacyProfileDirectory && (
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">已有草稿与桌面数据</dt>
                  <dd className="[overflow-wrap:anywhere] select-text">
                    {snapshot.legacyProfileDirectory}
                  </dd>
                </div>
              )}
            </dl>
            <FieldGroup>
              <Field
                data-disabled={!editable}
                data-invalid={
                  issue?.stage === "target" &&
                  target === snapshot.targetDirectory
                }
              >
                <FieldLabel htmlFor="startup-target">
                  {committed ? "已启用的数据目录" : "新的数据目录"}
                </FieldLabel>
                {editable ? (
                  <InputGroup>
                    <InputGroupInput
                      id="startup-target"
                      variant="compact"
                      value={target}
                      onChange={(event) => onTargetChange(event.target.value)}
                      aria-invalid={
                        issue?.stage === "target" &&
                        target === snapshot.targetDirectory
                      }
                      aria-describedby="startup-target-description"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="sm"
                        disabled={
                          !snapshot.capabilities.chooseDirectory || busy
                        }
                        onClick={() => onAction("choose")}
                      >
                        <FolderOpen data-icon="inline-start" />
                        选择目录
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                ) : (
                  <p
                    id="startup-target"
                    className="text-[13px] leading-5 [overflow-wrap:anywhere] select-text"
                  >
                    {snapshot.targetDirectory}
                  </p>
                )}
                {!committed && !running && (
                  <FieldDescription id="startup-target-description">
                    选择新建或空的 Moon 专用目录。
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>
            {statistics && (
              <p className="text-xs leading-5 text-muted-foreground">
                {statistics}
              </p>
            )}
            {!issue &&
              (running ||
                (snapshot.phase === "ready" && !expired) ||
                committed) && (
                <div
                  role="status"
                  className="flex flex-col gap-1 text-sm leading-6"
                >
                  <p>
                    {snapshot.phase === "ready" && !planValid
                      ? "目录已更改，请重新检查后继续。"
                      : fresh && snapshot.phase === "readyToOpen"
                        ? "新的数据目录已启用"
                        : fresh && snapshot.phase === "inspecting"
                          ? "正在检查新的数据目录"
                          : fresh && snapshot.phase === "copying"
                            ? "正在初始化新的数据集"
                            : fresh && snapshot.phase === "validating"
                              ? "正在核验新的数据集"
                              : phases[snapshot.phase]}
                  </p>
                  {snapshot.phase === "copying" && !fresh && (
                    <p className="text-xs text-muted-foreground">
                      {snapshot.fileCount === null
                        ? `已复制 ${snapshot.completedFiles} 个文件`
                        : `已复制 ${snapshot.completedFiles} / ${snapshot.fileCount} 个文件`}
                      {snapshot.copiedBytes !== null &&
                        ` · ${formatBytes(snapshot.copiedBytes)}`}
                    </p>
                  )}
                  {running && (
                    <p className="text-xs text-muted-foreground">
                      请保持窗口打开，原副本保留。
                    </p>
                  )}
                </div>
              )}
            {expired && !running && !committed && (
              <StatusMessage
                title="检查结果已过期"
                message="请重新检查目录后继续。"
                severity="info"
              />
            )}
            {issue && (
              <div className="flex flex-col gap-2">
                <StatusMessage
                  title={
                    committed
                      ? "启动未完成"
                      : fresh
                        ? "初始化未完成"
                        : "导入未完成"
                  }
                  message={issue.message}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {advice(issue, fresh)}
                </p>
                <IssueDetails
                  key={`${issue.code}:${issue.path}`}
                  issue={issue}
                />
              </div>
            )}
          </>
        ) : !view.loaded ? (
          <p role="status" className="text-sm leading-6 text-muted-foreground">
            正在读取启动状态…
          </p>
        ) : !view.issue ? (
          <p role="status" className="text-sm leading-6 text-muted-foreground">
            当前窗口没有等待选择的启动任务。请重新打开 Moon 桌面应用。
          </p>
        ) : null}
        {view.issue && !issue && (
          <StatusMessage
            title="启动状态需要核对"
            message={view.issue.message}
            severity="warning"
          />
        )}
        {hasActions && (
          <>
            <Separator />
            <footer className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {snapshot?.capabilities.exit && (
                  <Button
                    variant="ghost"
                    disabled={busy || !connected}
                    onClick={() => onAction("exit")}
                  >
                    退出 Moon
                  </Button>
                )}
                {issue && snapshot?.capabilities.openDiagnostics && (
                  <Button
                    variant="outline"
                    disabled={busy || !connected}
                    onClick={() => onAction("diagnostics")}
                  >
                    打开记录目录
                  </Button>
                )}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                {(view.issue?.retryable || (snapshot && !view.listening)) && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => onAction("refresh")}
                  >
                    {pending === "refresh" ? "正在读取…" : "重新读取状态"}
                  </Button>
                )}
                {snapshot && !running && (
                  <Button
                    disabled={!primaryAllowed}
                    onClick={() => onAction(primary)}
                  >
                    {pending === "prepare"
                      ? "正在检查…"
                      : pending === "continue"
                        ? "正在启动…"
                        : pending === "retry"
                          ? "正在重试…"
                          : pending === "start"
                            ? "正在开始…"
                            : primary === "continue"
                              ? "启动 Moon"
                              : primary === "retry"
                                ? fresh
                                  ? "重试初始化"
                                  : "重试导入"
                                : primary === "fresh"
                                  ? pending === "fresh"
                                    ? "正在启动…"
                                    : "不导入，直接启动"
                                  : primary === "start"
                                    ? "导入并启动"
                                    : snapshot.selection === "import"
                                      ? "重新检查目录"
                                      : "导入旧数据"}
                  </Button>
                )}
                {snapshot && !running && !committed && !fresh && (
                  <Button
                    variant="outline"
                    disabled={!freshAllowed}
                    onClick={() => onAction("fresh")}
                  >
                    {pending === "fresh" ? "正在启动…" : "不导入，直接启动"}
                  </Button>
                )}
                {fresh && editable && (
                  <Button
                    variant="outline"
                    disabled={!target.trim()}
                    onClick={() => onAction("prepare")}
                  >
                    导入旧数据
                  </Button>
                )}
              </div>
            </footer>
          </>
        )}
      </section>
    </main>
  )
}
