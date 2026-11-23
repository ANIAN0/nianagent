// @ts-check
// S2a 工作台服务层：操作定义（S0c 契约 v1 + Q15/Q11 修订）+ actor 解析 + MCP sharedTools 声明。
// actor：MCP=认证上下文 actorId（Agent）；Pi=internal-pi；UI(local/remote)=local-user。
// 写操作必须有可判定的 actor 与请求身份；set_thread_status 按 isUser 区分权限（用户可解决任何线程）。
// 每个 operation 携带 owner: "workbench"（G05）；宿主激活时校验，缺失即启动失败。
import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readOnlyTools, toolOperations } from "./tool-catalog.mjs"
import { diagnosticFrames } from "../../../logger.mjs"
import { currentTraceId } from "../../../request-context.mjs"
import { redactSensitive } from "../../../redact.mjs"
import { WorkbenchError } from "./errors.mjs"
import {
  resolveAnchor,
  resolveCrossBlock,
  InvalidAnchorError,
  snapshotAnchor,
} from "./markdown.mjs"
import { diffCanvas, groupMembership } from "./readers/board.mjs"

const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const int = (description, extra = {}) => ({
  type: "integer",
  description,
  ...extra,
})
const bool = (description) => ({ type: "boolean", description })
const listOf = (description) => ({
  type: "array",
  items: { type: "object" },
  description,
})

export function resolveActor(context) {
  if (
    context &&
    (context.source === "mcp" || context.source === "pi") &&
    typeof context.actorId === "string" &&
    context.actorId
  )
    return { actorId: context.actorId, isUser: false }
  if (context && (context.source === "local" || context.source === "remote"))
    return { actorId: "local-user", isUser: true }
  return null
}

const requireActor = (context) => {
  const actor = resolveActor(context)
  if (!actor)
    throw new WorkbenchError(
      "identity_denied",
      "缺少可信身份上下文，无法执行写操作。"
    )
  return actor
}

/** 深链入口地址：工作台根 + hash 参数；不携带任何长期凭据（openUrl 契约）。 */
const versionOpenUrl = (baseUrl, draftId, versionId, compareVersionId) => {
  const params = new URLSearchParams({ draft: draftId, version: versionId })
  if (compareVersionId) params.set("compare", compareVersionId)
  return `${baseUrl}#v2?${params.toString()}`
}

export function createV2Service(
  store,
  { event, baseUrl = "/", logger, inventory, changed, openVersionUrl }
) {
  const openUrl = (draftId, versionId, compareVersionId) =>
    openVersionUrl
      ? openVersionUrl(draftId, versionId, compareVersionId)
      : versionOpenUrl(baseUrl, draftId, versionId, compareVersionId)
  const activeCalls = new Set()
  const lifetime = new AbortController()
  let closing

  const log = (name, detail) => {
    try {
      event?.("v2", `${name} ${detail ?? ""}`.trim())
    } catch {
      // 事件日志失败不改变业务结果
    }
  }
  // G11：一次终态一条结构化记录；error.cause 仅脱敏摘要（错误消息本身已脱敏）
  const structured = (definition, record) => {
    try {
      logger?.append({
        module: "workbench",
        event: definition.title ?? "",
        level: record.level,
        traceId: record.traceId,
        operationId: record.operationId,
        outcome: record.outcome,
        durationMs: record.durationMs,
        error: record.error,
      })
    } catch {
      // 日志失败不改变业务回执
    }
  }

  const wrap = (definition, execute) => {
    const run = async (input, context, signal) => {
      const startedAt = Date.now()
      const traceId = context?.traceId || currentTraceId() || randomUUID()
      const operationId = context?.callId || randomUUID()
      try {
        signal?.throwIfAborted()
        const value = await execute(input, context, signal)
        if (definition.effect?.startsWith("写入") && value?.replayed !== true)
          changed?.()
        structured(definition, {
          level: definition.effect?.startsWith("写入") ? "info" : "debug",
          traceId,
          operationId,
          outcome: "committed",
          durationMs: Date.now() - startedAt,
        })
        return { value }
      } catch (error) {
        // 错误端口最小接入（G09）：code + errorId + outcome 贯通工作台链路，可按 errorId 定位
        const errorId = randomUUID().slice(0, 8)
        const code =
          error instanceof WorkbenchError || error instanceof InvalidAnchorError
            ? error.code
            : error?.name === "AbortError"
              ? "cancelled"
              : "internal_error"
        const message = error instanceof Error ? error.message : String(error)
        // G20：internal_error/取消无法证明领域未接受，outcome 保持 unknown，不按错误类推断为 rejected；
        // 业务事件流（host.logs，用户可见）只带安全摘要，原始消息仅保留在本地结构化诊断日志
        const safeMessage =
          code === "internal_error" || code === "cancelled"
            ? "工作台操作未完成，请查看工作台诊断日志后重试。"
            : message
        const outcome =
          code === "internal_error" || code === "cancelled"
            ? "unknown"
            : "rejected"
        log(definition.title ?? "", `${code}#${errorId}: ${safeMessage}`)
        structured(definition, {
          level: code === "cancelled" ? "warn" : "error",
          traceId,
          operationId,
          outcome,
          durationMs: Date.now() - startedAt,
          error: {
            code,
            errorId,
            cause: safeMessage,
            frames: diagnosticFrames(error),
          },
        })
        throw Object.assign(new Error(message, { cause: error }), {
          name: "MoonOperationError",
          code,
          errorId,
          issue: {
            code,
            module: "workbench",
            safeMessage,
            summary: safeMessage,
            recovery: outcome === "unknown" ? "check" : "reload",
            severity: code === "cancelled" ? "info" : "error",
            errorId,
            traceId,
            outcome,
          },
        })
      }
    }
    return {
      ...definition,
      execute(input, context, signal) {
        if (lifetime.signal.aborted)
          return Promise.reject(
            new WorkbenchError("cancelled", "工作台正在关闭，未接受新操作。")
          )
        const pending = run(
          input,
          context,
          AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])])
        )
        activeCalls.add(pending)
        void pending.then(
          () => activeCalls.delete(pending),
          () => activeCalls.delete(pending)
        )
        return pending
      },
    }
  }

  const actor = (context) => requireActor(context)
  const optionalActor = (context) => resolveActor(context)

  const markdownVersion = async (versionId) => {
    const data = await store.readMarkdownVersion(versionId)
    // 冻结阅读表示随包封存；读取不再重新解析（Q04）
    return { ...data, blocks: data.reading.blocks }
  }

  const operations = {
    v2_create_project: wrap(
      {
        title: "创建工作台项目",
        owner: "workbench",
        input: obj({
          name: str("项目名", { maxLength: 64 }),
          requestKey: str("请求键（幂等；同键异输入拒绝）", {
            minLength: 1,
            maxLength: 128,
          }),
        }),
        output: obj({
          value: obj({
            id: str("项目标识"),
            name: str("项目名"),
            replayed: bool("是否为重放结果"),
          }),
        }),
        effect: "写入：新建项目；重放核对完整输入签名。",
      },
      (input, context) => {
        const { actorId } = actor(context)
        log("create_project", `actor=${actorId}`)
        return store.createProject(input.name, actorId, input.requestKey)
      }
    ),
    v2_update_project: wrap(
      {
        title: "更新工作台项目",
        owner: "workbench",
        input: obj(
          {
            projectId: str("项目标识", { minLength: 1 }),
            name: str("新名称；可空", { maxLength: 64 }),
            archived: bool("归档(true)/恢复(false)；可空"),
            requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
          },
          ["projectId", "requestKey"]
        ),
        output: obj({
          value: obj({
            id: str("项目标识"),
            name: str("名称"),
            archived: bool("是否归档"),
            replayed: bool("是否为重放结果"),
          }),
        }),
        effect: "写入：改名与归档/恢复；请求身份幂等。",
      },
      (input, context) => {
        const { actorId } = actor(context)
        return store.updateProject(
          input.projectId,
          { name: input.name, archived: input.archived },
          actorId,
          input.requestKey
        )
      }
    ),
    v2_list_projects: wrap(
      {
        title: "列出工作台项目",
        owner: "workbench",
        input: obj(
          {
            cursor: str("分页游标（keyset，服务端签发原样回传）；可空", {
              maxLength: 256,
            }),
            archived: bool("包含已归档项目；缺省仅未归档（AC18 一致归档语义）"),
          },
          []
        ),
        output: obj({
          value: obj({
            items: listOf("项目"),
            complete: bool("本页是否完整"),
            nextCursor: {
              type: ["string", "null"],
              description: "下一页 keyset 游标",
            },
          }),
        }),
        effect:
          "读取：项目列表（keyset 分页；默认仅未归档，恢复浏览显式传 archived）。",
      },
      async (input) =>
        store.listProjects(input.cursor, 50, {
          archived: input.archived ?? false,
        })
    ),
    v2_create_directory: wrap(
      {
        title: "创建工作台目录",
        owner: "workbench",
        input: obj(
          {
            projectId: str("项目标识", { minLength: 1 }),
            parentId: str("父目录标识；空字符串为根", { maxLength: 64 }),
            name: str("目录名", { maxLength: 64 }),
            requestKey: str("请求键（幂等；同键异输入拒绝）", {
              minLength: 1,
              maxLength: 128,
            }),
          },
          ["projectId", "name", "requestKey"]
        ),
        output: obj({
          value: obj({
            id: str("目录标识"),
            name: str("目录名"),
            replayed: bool("是否为重放结果"),
          }),
        }),
        effect: "写入：新建目录；重放核对完整输入签名。",
      },
      (input, context) => {
        const { actorId } = actor(context)
        return store.createDirectory(
          input.projectId,
          input.parentId || null,
          input.name,
          actorId,
          input.requestKey
        )
      }
    ),
    v2_update_directory: wrap(
      {
        title: "更新工作台目录",
        owner: "workbench",
        input: obj(
          {
            directoryId: str("目录标识", { minLength: 1 }),
            parentId: {
              type: ["string", "null"],
              maxLength: 64,
              description: "新父目录；null 移到项目根，省略则不移动",
            },
            name: str("新名称；可空", { maxLength: 64 }),
            archived: bool("归档(true)/恢复(false)；可空"),
            requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
          },
          ["directoryId", "requestKey"]
        ),
        output: obj({
          value: obj({
            id: str("目录标识"),
            name: str("名称"),
            parentId: { type: ["string", "null"], description: "父目录" },
            archived: bool("是否归档"),
            replayed: bool("是否为重放结果"),
          }),
        }),
        effect: "写入：改名/移动/归档/恢复；目录环明确拒绝。",
      },
      (input, context) => {
        const { actorId } = actor(context)
        return store.updateDirectory(
          input.directoryId,
          {
            name: input.name,
            ...(Object.hasOwn(input, "parentId")
              ? { parentId: input.parentId }
              : {}),
            archived: input.archived,
          },
          actorId,
          input.requestKey
        )
      }
    ),
    v2_list_directories: wrap(
      {
        title: "列出项目目录",
        owner: "workbench",
        input: obj(
          {
            projectId: str("项目标识", { minLength: 1 }),
            cursor: str("分页游标（keyset）；可空", { maxLength: 256 }),
            archived: bool("包含已归档目录；缺省仅未归档（AC18 一致归档语义）"),
          },
          ["projectId"]
        ),
        output: obj({
          value: obj({
            items: listOf("目录（含完整归属）"),
            complete: bool("本页是否完整"),
            nextCursor: {
              type: ["string", "null"],
              description: "下一页 keyset 游标",
            },
          }),
        }),
        effect: "读取：目录列表（keyset 分页，含归属；默认仅未归档）。",
      },
      async (input) =>
        store.listDirectories(input.projectId, input.cursor, 50, {
          archived: input.archived ?? false,
        })
    ),
    v2_create_draft: wrap(
      {
        title: "创建工作台草稿",
        owner: "workbench",
        input: obj({
          directoryId: str("目录标识", { minLength: 1 }),
          kind: str("草稿类型：markdown/board/ui", { maxLength: 8 }),
          title: str("草稿标题", { maxLength: 120 }),
          requestKey: str("请求键（幂等；同键异输入拒绝）", {
            minLength: 1,
            maxLength: 128,
          }),
        }),
        output: obj({
          value: obj({
            id: str("草稿标识"),
            kind: str("类型"),
            replayed: bool("是否为重放结果"),
          }),
        }),
        effect: "写入：新建草稿；重放核对完整输入签名。",
      },
      (input, context) => {
        const { actorId } = actor(context)
        return store.createDraft(
          input.directoryId,
          input.kind,
          input.title,
          actorId,
          input.requestKey
        )
      }
    ),
    v2_update_draft: wrap(
      {
        title: "更新工作台草稿",
        owner: "workbench",
        input: obj(
          {
            draftId: str("草稿标识", { minLength: 1 }),
            title: str("新标题；可空", { maxLength: 120 }),
            directoryId: str("目标目录（移动）；可空", { maxLength: 64 }),
            archived: bool("归档(true)/恢复(false)；可空"),
            consensusStatus: str(
              "共识状态：discussing / pending_confirm / agreed；可空",
              { maxLength: 32 }
            ),
            metadataRevision: int("并发覆盖保护；可空"),
            requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
          },
          ["draftId", "requestKey"]
        ),
        output: obj({
          value: obj(
            {
              id: str("草稿标识"),
              title: str("标题"),
              directoryId: str("目录"),
              consensusStatus: str("共识状态"),
              archived: bool("是否归档"),
              metadataRevision: int("修订号"),
              replayed: bool("是否为重放结果"),
            },
            [
              "id",
              "title",
              "directoryId",
              "archived",
              "metadataRevision",
              "replayed",
            ]
          ),
        }),
        effect:
          "写入：改名/移动/归档/恢复/共识状态；metadataRevision 过期明确冲突。",
      },
      (input, context) => {
        const { actorId } = actor(context)
        return store.updateDraft(
          input.draftId,
          {
            title: input.title,
            directoryId: input.directoryId,
            archived: input.archived,
            consensusStatus: input.consensusStatus,
          },
          actorId,
          input.requestKey,
          input.metadataRevision
        )
      }
    ),
    v2_list_drafts: wrap(
      {
        title: "查找工作台草稿",
        owner: "workbench",
        input: obj(
          {
            projectId: str("项目标识；可空", { maxLength: 64 }),
            kind: str("类型筛选；可空", { maxLength: 8 }),
            archived: bool("是否包含已归档"),
            cursor: str("分页游标（keyset）；可空", { maxLength: 256 }),
          },
          []
        ),
        output: obj({
          value: obj({
            items: listOf("草稿"),
            complete: bool("本页是否完整"),
            nextCursor: {
              type: ["string", "null"],
              description: "下一页 keyset 游标",
            },
          }),
        }),
        effect: "读取：草稿列表（keyset 分页）。",
      },
      async (input) =>
        store.listDrafts(
          {
            projectId: input.projectId || undefined,
            kind: input.kind || undefined,
            archived: input.archived === true,
          },
          input.cursor
        )
    ),
    v2_stage_package: wrap(
      {
        title: "导入内容包",
        owner: "workbench",
        input: obj({
          sourceDir: str("本机源目录绝对路径", { minLength: 1 }),
          kind: str("内容类型：markdown/board/ui", { maxLength: 8 }),
        }),
        output: obj({
          value: obj({
            artifactId: str("产物标识"),
            fileCount: int("文件数"),
            totalBytes: int("总字节数"),
          }),
        }),
        effect:
          "写入：复制源目录、生成冻结表示并封存为不可变产物（记录导入者）。",
      },
      async (input, context, signal) => {
        const { actorId } = actor(context)
        log("stage_package", `actor=${actorId} kind=${input.kind}`)
        return store.stagePackage(input.sourceDir, input.kind, actorId, {
          signal,
        })
      }
    ),
    v2_publish_version: wrap(
      {
        title: "发布版本",
        owner: "workbench",
        input: obj(
          {
            draftId: str("草稿标识", { minLength: 1 }),
            baseSequence: int("基础版本序号", { minimum: 0 }),
            artifactId: str("产物标识", { minLength: 1 }),
            requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
            summary: str("发布说明；可空", { maxLength: 2000 }),
          },
          ["draftId", "baseSequence", "artifactId", "requestKey"]
        ),
        output: obj({
          value: obj({
            versionId: str("版本标识"),
            sequence: int("版本序号"),
            replayed: bool("是否为重放结果"),
            draftId: str("草稿标识"),
            reviewRevision: int("审阅修订号"),
            projectId: str("项目标识"),
            title: str("草稿标题"),
            openUrl: str("可打开的固定版本入口（无长期凭据）"),
          }),
        }),
        effect: "写入：封存产物绑定新版本；重放返回原结果；base 过期明确冲突。",
      },
      async (input, context) => {
        const { actorId } = actor(context)
        const result = store.publishVersion(
          {
            draftId: input.draftId,
            baseSequence: input.baseSequence,
            artifactId: input.artifactId,
            requestKey: input.requestKey,
            summary: input.summary,
          },
          actorId
        )
        log(
          "publish_version",
          `actor=${actorId} seq=${result.sequence} replay=${result.replayed}`
        )
        return {
          ...result,
          ...store.draftReference(input.draftId),
          reviewRevision: store.reviewRevision(input.draftId),
          openUrl: openUrl(input.draftId, result.versionId),
        }
      }
    ),
    v2_publish_inline: wrap(
      {
        title: "直接编辑并发布版本",
        owner: "workbench",
        input: obj(
          {
            draftId: str("草稿标识", { minLength: 1 }),
            baseSequence: int("基础版本序号", { minimum: 0 }),
            kind: str("内容类型：markdown/board", { maxLength: 8 }),
            markdown: str("markdown 正文；kind=markdown 时必填", {
              maxLength: 2000000,
            }),
            canvas: {
              type: "object",
              description: "board 画布 JSON；kind=board 时必填",
            },
            requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
            summary: str("发布说明；可空", { maxLength: 2000 }),
          },
          ["draftId", "baseSequence", "kind", "requestKey"]
        ),
        output: obj({
          value: obj({
            versionId: str("版本标识"),
            artifactId: str("封存产物标识"),
            sequence: int("版本序号"),
            replayed: bool("是否为重放结果"),
            draftId: str("草稿标识"),
            reviewRevision: int("审阅修订号"),
            projectId: str("项目标识"),
            title: str("草稿标题"),
            openUrl: str("可打开的固定版本入口（无长期凭据）"),
          }),
        }),
        effect:
          "写入：将工作台内编辑的文档/白板封装为不可变产物并发布新版本；base 过期明确冲突。",
      },
      async (input, context, signal) => {
        const { actorId } = actor(context)
        const {
          draftId,
          kind,
          markdown,
          canvas,
          baseSequence,
          requestKey,
          summary,
        } = input
        const finish = (result) => ({
          ...result,
          ...store.draftReference(draftId),
          reviewRevision: store.reviewRevision(draftId),
          openUrl: openUrl(draftId, result.versionId),
        })
        const previous = store.readReceipt("publish_inline", actorId, input)
        if (previous) return finish(previous)

        const draft = store.draft(draftId)
        if (draft.kind !== kind)
          throw new WorkbenchError(
            "validation_failed",
            "提交的内容类型与草稿不符。"
          )
        if (kind !== "markdown" && kind !== "board")
          throw new WorkbenchError(
            "unsupported_artifact",
            "仅文档与白板支持工作台内直接编辑发布。"
          )
        if (
          kind === "markdown"
            ? typeof markdown !== "string" || canvas !== undefined
            : !canvas ||
              typeof canvas !== "object" ||
              Array.isArray(canvas) ||
              markdown !== undefined
        )
          throw new WorkbenchError(
            "validation_failed",
            "提交内容与编辑类型不符。"
          )

        const staging = await mkdtemp(join(tmpdir(), "moon-notes-inline-"))
        let unusedArtifactId
        try {
          await writeFile(
            join(staging, kind === "markdown" ? "index.md" : "board.canvas"),
            kind === "markdown" ? markdown : JSON.stringify(canvas, null, 2),
            "utf8"
          )
          const { artifactId } = await store.stagePackage(
            staging,
            kind,
            actorId,
            { signal }
          )
          unusedArtifactId = artifactId
          signal.throwIfAborted()
          const result = store.publishVersion(
            { draftId, baseSequence, artifactId, requestKey, summary },
            actorId,
            input
          )
          if (!result.replayed) unusedArtifactId = undefined
          log(
            "publish_inline",
            `actor=${actorId} seq=${result.sequence} replay=${result.replayed}`
          )
          return finish(result)
        } finally {
          try {
            if (unusedArtifactId)
              await store.discardUnpublishedArtifact(unusedArtifactId)
          } finally {
            await rm(staging, { recursive: true, force: true })
          }
        }
      }
    ),
    v2_list_versions: wrap(
      {
        title: "列出草稿版本",
        owner: "workbench",
        input: obj(
          {
            draftId: str("草稿标识", { minLength: 1 }),
            cursor: int("分页游标；可空", { minimum: 0 }),
          },
          ["draftId"]
        ),
        output: obj({
          value: obj({
            items: listOf("版本"),
            complete: bool("本页是否完整"),
            nextCursor: {
              type: ["integer", "null"],
              description: "下一页游标",
            },
          }),
        }),
        effect: "读取：版本列表（分页）。",
      },
      async (input) => store.listVersions(input.draftId, input.cursor)
    ),
    v2_read_version: wrap(
      {
        title: "读取版本内容",
        owner: "workbench",
        input: obj(
          {
            draftId: str("草稿标识", { minLength: 1 }),
            versionId: str("版本标识；可空则最新", { maxLength: 64 }),
          },
          ["draftId"]
        ),
        output: obj({
          value: obj(
            {
              versionId: str("实际版本标识"),
              sequence: int("版本序号"),
              kind: str("内容类型"),
              rawMarkdown: str("markdown：原文"),
              blocks: {
                type: "array",
                items: { type: "object" },
                description: "markdown：冻结块投影",
              },
              canvas: {
                type: "object",
                description: "board：规范化画布（nodes/edges）",
              },
              manifest: {
                type: "object",
                description: "ui：路由清单（routes）",
              },
              files: { type: "array", items: str("包内文件路径") },
              reviewRevision: int("审阅修订号"),
            },
            ["versionId", "sequence", "kind", "files", "reviewRevision"]
          ),
        }),
        effect:
          "读取：按类型返回封存的冻结表示（markdown 块投影 / board 画布）与文件清单。",
      },
      async (input) => {
        const version = input.versionId
          ? store.version(input.versionId)
          : latestVersion(store, input.draftId)
        if (version.draftId !== input.draftId)
          throw new WorkbenchError("not_found", "版本不属于该草稿。")
        const data = await store.readVersionContent(version.id)
        const base = {
          versionId: data.versionId,
          sequence: data.sequence,
          kind: data.kind,
          files: data.files,
          reviewRevision: store.reviewRevision(input.draftId),
        }
        if (data.kind === "markdown") {
          if (!Array.isArray(data.reading.blocks))
            throw new WorkbenchError(
              "storage_failure",
              "版本冻结阅读表示无效。"
            )
          const rawMarkdown = (
            await store.readAsset(version.id, data.reading.entry)
          ).toString("utf8")
          return {
            ...base,
            rawMarkdown,
            blocks: data.reading.blocks.map(({ index, type, text, html }) => ({
              index,
              type,
              text,
              html,
            })),
          }
        }
        if (data.kind === "board") {
          return {
            ...base,
            canvas: data.reading.canvas,
          }
        }
        if (data.kind === "ui") {
          return { ...base, manifest: data.reading.manifest }
        }
        throw new WorkbenchError(
          "unsupported_artifact",
          "该类型阅读表示尚未接入。"
        )
      }
    ),
    v2_list_targets: wrap(
      {
        title: "列出定位目标",
        owner: "workbench",
        input: obj(
          {
            versionId: str("版本标识", { minLength: 1 }),
            cursor: int("分页游标；可空", { minimum: 0 }),
          },
          ["versionId"]
        ),
        output: obj({
          value: obj(
            {
              versionId: str("实际版本标识"),
              draftId: str("草稿标识"),
              kind: str("版本产物类型", { enum: ["markdown", "board", "ui"] }),
              items: listOf(
                "定位目标（markdown 块引用；board 对象；ui 路由+运行时元素清单）"
              ),
              complete: bool("本页是否完整"),
              nextCursor: {
                type: ["integer", "null"],
                description: "下一页游标",
              },
              elementsSupported: bool("ui：运行时元素清单能力（AC22）"),
              dynamicCaptured: int("ui：已采集页数"),
              note: str("采集说明"),
            },
            ["versionId", "draftId", "kind", "items", "complete", "nextCursor"]
          ),
        }),
        effect:
          "读取：markdown 冻结块分页；board 对象（含组归属/连线端点）；ui 路由+最近一次用户预览采集的运行时元素清单。",
      },
      async (input) => {
        const result = await store.listTargets(input.versionId, input.cursor)
        if (result.kind !== "ui") return result
        // AC22-二轮：合并运行时元素清单（UiReader 采集→宿主缓存→本工具消费）
        const dynamic = inventory?.forVersion?.(input.versionId)
        return {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            elements: Array.isArray(dynamic?.pages?.[item.page]?.elements)
              ? dynamic.pages[item.page].elements
              : [],
            capturedAt: dynamic?.pages?.[item.page]?.capturedAt ?? null,
          })),
          elementsSupported: true,
          dynamicCaptured: dynamic ? Object.keys(dynamic.pages).length : 0,
          note: "elements 为最近一次用户预览采集的运行时元素清单（tag/id/text/rect）；无采集记录时经 read_version 与 read_asset 获取页面源码。",
        }
      }
    ),
    v2_read_asset: wrap(
      {
        title: "读取版本资源",
        owner: "workbench",
        input: obj(
          {
            versionId: str("版本标识", { minLength: 1 }),
            path: str("包内资源路径", { minLength: 1, maxLength: 512 }),
            offset: int("分片偏移；可空", { minimum: 0 }),
          },
          ["versionId", "path"]
        ),
        output: obj({
          value: obj({
            path: str("资源路径"),
            totalBytes: int("总字节数"),
            offset: int("本片偏移"),
            data: str("本片内容（base64）"),
            nextOffset: {
              type: ["integer", "null"],
              description: "下一片偏移；null 为读取完整",
            },
            complete: bool("是否已读取完整"),
          }),
        }),
        effect:
          "读取：版本内资源分片（base64）；路径越界与符号链接逃逸明确拒绝。",
      },
      async (input) =>
        store.readAssetChunk(input.versionId, input.path, input.offset ?? 0)
    ),
    v2_compare_versions: wrap(
      {
        title: "比较两个版本",
        owner: "workbench",
        input: obj({
          draftId: str("草稿标识", { minLength: 1 }),
          leftVersionId: str("左版本标识", { minLength: 1 }),
          rightVersionId: str("右版本标识", { minLength: 1 }),
        }),
        output: obj({
          value: obj({
            left: obj({ versionId: str("版本"), sequence: int("序号") }),
            right: obj({ versionId: str("版本"), sequence: int("序号") }),
            kind: str("内容类型"),
            hunks: {
              type: "array",
              items: { type: "object" },
              description: "markdown：行级差异",
            },
            diff: { type: "object", description: "board：五类对象差异" },
            leftRaw: { type: "string", description: "markdown：左版原文" },
            rightRaw: { type: "string", description: "markdown：右版原文" },
          }),
        }),
        effect:
          "读取：markdown 行级差异与两侧原文；board 对象五类差异；两侧版本必须属于输入草稿。",
      },
      async (input) => {
        const leftVersion = store.version(input.leftVersionId)
        const rightVersion = store.version(input.rightVersionId)
        // 两侧版本都必须属于输入草稿；跨草稿比较明确拒绝（Q06）
        if (
          leftVersion.draftId !== input.draftId ||
          rightVersion.draftId !== input.draftId
        )
          throw new WorkbenchError(
            "validation_failed",
            "比较版本不属于输入草稿。"
          )
        const left = await store.readVersionContent(input.leftVersionId)
        const right = await store.readVersionContent(input.rightVersionId)
        if (left.kind !== right.kind)
          throw new WorkbenchError(
            "validation_failed",
            "两侧版本类型不同，无法比较。"
          )
        const base = {
          left: { versionId: leftVersion.id, sequence: leftVersion.sequence },
          right: {
            versionId: rightVersion.id,
            sequence: rightVersion.sequence,
          },
          kind: left.kind,
        }
        if (left.kind === "markdown") {
          const { readFile } = await import("node:fs/promises")
          const { join } = await import("node:path")
          const leftRaw = await readFile(
            join(
              store.versionArtifactPath(input.leftVersionId),
              left.reading.entry
            ),
            "utf8"
          )
          const rightRaw = await readFile(
            join(
              store.versionArtifactPath(input.rightVersionId),
              right.reading.entry
            ),
            "utf8"
          )
          return {
            ...base,
            ...store.compareMarkdown(leftRaw, rightRaw),
            leftRaw,
            rightRaw,
          }
        }
        if (left.kind === "board") {
          return {
            ...base,
            diff: diffCanvas(left.reading.canvas, right.reading.canvas),
          }
        }
        if (left.kind === "ui") {
          // ui 比较：路由级差异（文件内容不做哈希/内容比较；视觉比较由阅读器双会话呈现）
          const leftRoutes = new Set(Object.keys(left.reading.manifest.routes))
          const rightRoutes = new Set(
            Object.keys(right.reading.manifest.routes)
          )
          const added = [...rightRoutes].filter(
            (route) => !leftRoutes.has(route)
          )
          const removed = [...leftRoutes].filter(
            (route) => !rightRoutes.has(route)
          )
          const changed = [...leftRoutes].filter(
            (route) =>
              rightRoutes.has(route) &&
              left.reading.manifest.routes[route] !==
                right.reading.manifest.routes[route]
          )
          return {
            ...base,
            diff: {
              added: added.map((page) => ({ page })),
              removed: removed.map((page) => ({ page })),
              changed: changed.map((page) => ({ page })),
            },
          }
        }
        throw new WorkbenchError("unsupported_artifact", "该类型比较尚未接入。")
      }
    ),
    v2_create_thread: wrap(
      {
        title: "创建定位评论",
        owner: "workbench",
        input: obj(
          {
            versionId: str("版本标识", { minLength: 1 }),
            target: {
              type: "object",
              description:
                'markdown 定位：block+exact+可选 prefix/suffix；跨块传 segments 数组；整篇评论传 kind="document"',
              properties: {
                kind: str(
                  "document 整篇；board 白板对象；ui 界面元素；可空为 markdown 块定位"
                ),
                objectId: str("board：对象标识；可空"),
                objectType: str(
                  "board：node/edge/group；可空（服务端按版本画布重建）"
                ),
                attributes: {
                  type: "object",
                  description:
                    "ui：桥采集的元素属性（键值均字符串，宿主按快照保留）；可空",
                  properties: {},
                  additionalProperties: { type: "string" },
                },
                page: str("ui：页面路由；可空"),
                tag: str("ui：元素标签；可空"),
                id: str("ui：元素 id；可空"),
                classes: str("ui：元素类名；可空"),
                text: str("ui：元素文本摘录；可空"),
                rect: { type: "object", description: "ui：元素矩形；可空" },
                viewport: { type: "object", description: "ui：视口；可空" },
                block: int("块索引"),
                exact: str("引文"),
                prefix: str("前文；可空"),
                suffix: str("后文；可空"),
                segments: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      block: int("块索引"),
                      exact: str("引文"),
                      prefix: str("前文；可空"),
                      suffix: str("后文；可空"),
                    },
                    additionalProperties: false,
                  },
                },
              },
              additionalProperties: false,
            },
            body: str("评论正文", { maxLength: 8000 }),
            requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
          },
          ["versionId", "target", "body", "requestKey"]
        ),
        output: obj({
          value: obj({
            threadId: str("线程标识"),
            replyId: str("回复标识"),
            replayed: bool("是否为重放结果"),
            anchor: { type: "object" },
          }),
        }),
        effect:
          "写入：线程固定创建时版本；服务端唯一解析锚点并持久化 resolved 快照。",
      },
      async (input, context) => {
        const { actorId } = actor(context)
        let data = null
        if (
          input.target?.kind !== "document" &&
          input.target?.kind !== "board" &&
          input.target?.kind !== "ui"
        )
          data = await markdownVersion(input.versionId)
        let resolved
        if (input.target?.kind === "document") {
          resolved = { kind: "document" }
        } else if (input.target?.kind === "board") {
          // board 定位：服务端校验对象存在于该版本画布，快照含对象文本（不猜测关联）
          const content = await store.readVersionContent(input.versionId)
          if (content.kind !== "board")
            throw new WorkbenchError(
              "invalid_anchor",
              "board 定位仅适用于白板版本。"
            )
          const canvas = content.reading.canvas
          const node = canvas.nodes.find(
            (item) => item.id === input.target.objectId
          )
          const edge = canvas.edges.find(
            (item) => item.id === input.target.objectId
          )
          const object = node ?? edge
          if (!object)
            throw new WorkbenchError(
              "invalid_anchor",
              "定位对象在该版本画布中不存在（invalid_anchor）。"
            )
          // AC22：线程快照携带既定关系上下文（组归属/连线端点），Agent 读回可获取对象原文与关系
          const membership = groupMembership(canvas)
          const group =
            node && node.type !== "group"
              ? membership.get(object.id)
              : undefined
          resolved = {
            kind: "board",
            objectId: object.id,
            objectType: node
              ? node.type === "group"
                ? "group"
                : "node"
              : "edge",
            quote: node
              ? node.text || object.id
              : edge.label || `${edge.from} → ${edge.to}`,
            context: node
              ? group
                ? {
                    group,
                    groupText:
                      canvas.nodes.find((item) => item.id === group)?.text ??
                      "",
                  }
                : {}
              : { from: edge.from, to: edge.to },
          }
        } else if (input.target?.kind === "ui") {
          // ui 定位：页面必须在版本 manifest 路由内；元素描述来自桥（T14）
          const content = await store.readVersionContent(input.versionId)
          if (content.kind !== "ui")
            throw new WorkbenchError(
              "invalid_anchor",
              "ui 定位仅适用于界面产物版本。"
            )
          const routes = content.reading.manifest.routes
          if (!routes[input.target.page])
            throw new WorkbenchError(
              "invalid_anchor",
              "定位页面未在版本路由清单中声明（invalid_anchor）。"
            )
          resolved = {
            kind: "ui",
            page: input.target.page,
            tag: input.target.tag,
            id: typeof input.target.id === "string" ? input.target.id : "",
            classes:
              typeof input.target.classes === "string"
                ? input.target.classes
                : "",
            text:
              typeof input.target.text === "string" ? input.target.text : "",
            rect: input.target.rect,
            viewport: input.target.viewport,
            ...(input.target.attributes &&
            typeof input.target.attributes === "object"
              ? { attributes: input.target.attributes }
              : {}),
          }
        } else if (Array.isArray(input.target?.segments)) {
          resolved = resolveCrossBlock(
            data.blocks,
            input.target.segments.map((segment) => ({
              block: segment.block,
              exact: segment.exact,
              prefix: segment.prefix ?? "",
              suffix: segment.suffix ?? "",
            }))
          )
        } else {
          resolved = resolveAnchor(data.blocks, {
            block: input.target?.block,
            exact: input.target?.exact,
            prefix: input.target?.prefix ?? "",
            suffix: input.target?.suffix ?? "",
          })
        }
        // document/board/ui 快照自含引用原样持久化；仅 markdown 需要 snapshotAnchor
        // 从版本块提取引文（ui/board 分派不加载 markdown 版本，data 为 null）
        const anchor =
          resolved.kind === "document" ||
          resolved.kind === "board" ||
          resolved.kind === "ui"
            ? resolved
            : snapshotAnchor(resolved, data.blocks)
        const result = store.createThread(
          input.versionId,
          anchor,
          input.body,
          input.requestKey,
          actorId
        )
        log(
          "create_thread",
          `actor=${actorId} version=${input.versionId.slice(0, 8)}`
        )
        return { ...result, anchor }
      }
    ),
    v2_add_reply: wrap(
      {
        title: "回复讨论",
        owner: "workbench",
        input: obj(
          {
            threadId: str("线程标识", { minLength: 1 }),
            body: str("回复正文", { maxLength: 8000 }),
            relatedVersionId: str("关联修改版本；可空", { maxLength: 64 }),
            requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
          },
          ["threadId", "body", "requestKey"]
        ),
        output: obj({
          value: obj({
            replyId: str("回复标识"),
            replayed: bool("是否为重放结果"),
          }),
        }),
        effect: "写入：回复可关联修改版本。",
      },
      async (input, context) => {
        const { actorId } = actor(context)
        const result = store.addReply(
          input.threadId,
          input.body,
          input.relatedVersionId || null,
          input.requestKey,
          actorId
        )
        log(
          "add_reply",
          `actor=${actorId} thread=${input.threadId.slice(0, 8)}`
        )
        return result
      }
    ),
    v2_set_thread_status: wrap(
      {
        title: "设置讨论状态",
        owner: "workbench",
        input: obj({
          threadId: str("线程标识", { minLength: 1 }),
          status: str("open 或 resolved", { maxLength: 8 }),
          requestKey: str("请求键（幂等；重复请求返回原事件）", {
            minLength: 1,
            maxLength: 128,
          }),
        }),
        output: obj({
          value: obj({
            threadId: str("线程标识"),
            status: str("状态"),
            changed: bool("是否发生变化"),
            replayed: bool("是否为重放结果"),
          }),
        }),
        effect:
          "写入：用户可解决任何线程；Agent 仅自己发起的线程；状态变化记录操作者与请求身份。",
      },
      async (input, context) => {
        const actor = optionalActor(context)
        if (!actor)
          throw new WorkbenchError("identity_denied", "缺少可信身份上下文。")
        const result = store.setThreadStatus(
          input.threadId,
          input.status,
          actor.actorId,
          {
            isUser: actor.isUser,
            requestKey: input.requestKey,
          }
        )
        log(
          "set_thread_status",
          `actor=${actor.actorId} status=${result.status}`
        )
        return result
      }
    ),
    v2_list_threads: wrap(
      {
        title: "列出讨论线程",
        owner: "workbench",
        input: obj(
          {
            draftId: str("草稿标识", { minLength: 1 }),
            versionId: str("按版本筛选；可空", { maxLength: 64 }),
            status: str("按状态筛选；可空", { maxLength: 8 }),
            authorActor: str("按线程或回复参与作者筛选；可空", {
              minLength: 1,
              maxLength: 128,
            }),
            cursor: str("分页游标（keyset）；可空", { maxLength: 256 }),
          },
          ["draftId"]
        ),
        output: obj({
          value: obj({
            items: listOf("线程（含持久化锚点）"),
            authorActors: {
              type: "array",
              items: { type: "string" },
              description: "该草稿全部讨论参与者，不受当前分页/筛选限制",
            },
            complete: bool("本页是否完整"),
            nextCursor: {
              type: ["string", "null"],
              description: "下一页 keyset 游标",
            },
            reviewRevision: int("审阅修订号"),
          }),
        }),
        effect:
          "读取：线程固定版本归属并携带锚点快照（keyset 分页）；实时列表语义。",
      },
      async (input) => ({
        ...store.listThreads(
          input.draftId,
          {
            versionId: input.versionId || undefined,
            status: input.status || undefined,
            authorActor: input.authorActor,
          },
          input.cursor
        ),
        reviewRevision: store.reviewRevision(input.draftId),
      })
    ),
    v2_read_thread: wrap(
      {
        title: "读取讨论线程与回复",
        owner: "workbench",
        input: obj(
          {
            threadId: str("线程标识", { minLength: 1 }),
            replyCursor: str("回复分页游标（keyset）；可空", {
              maxLength: 256,
            }),
          },
          ["threadId"]
        ),
        output: obj({
          value: obj({
            thread: { type: "object" },
            replies: obj({
              items: listOf("回复"),
              complete: bool("本页是否完整"),
              nextCursor: {
                type: ["string", "null"],
                description: "下一页 keyset 游标",
              },
            }),
          }),
        }),
        effect: "读取：线程详情与 keyset 分页回复。",
      },
      async (input) => store.readThread(input.threadId, input.replyCursor)
    ),
    v2_open_version: wrap(
      {
        title: "打开固定版本入口",
        owner: "workbench",
        input: obj(
          {
            draftId: str("草稿标识", { minLength: 1 }),
            versionId: str("版本标识", { minLength: 1 }),
            compareVersionId: str("比较版本标识；可空", { maxLength: 64 }),
          },
          ["draftId", "versionId"]
        ),
        output: obj({
          value: obj({
            draftId: str("草稿标识"),
            versionId: str("实际版本标识"),
            compareVersionId: {
              type: ["string", "null"],
              description: "比较版本",
            },
            openUrl: str("可打开的固定版本入口（无长期凭据）"),
          }),
        }),
        effect: "读取：签发固定版本深链；版本必须属于输入草稿。",
      },
      async (input) => {
        const version = store.version(input.versionId)
        if (version.draftId !== input.draftId)
          throw new WorkbenchError("not_found", "版本不属于该草稿。")
        if (input.compareVersionId) {
          const compare = store.version(input.compareVersionId)
          if (compare.draftId !== input.draftId)
            throw new WorkbenchError("not_found", "比较版本不属于该草稿。")
        }
        return {
          draftId: input.draftId,
          versionId: version.id,
          compareVersionId: input.compareVersionId ?? null,
          openUrl: openUrl(input.draftId, version.id, input.compareVersionId),
        }
      }
    ),
  }

  /** MCP sharedTools：S0c 工具面（Markdown 协作闭环 + 资源/入口，Q11 补齐）。 */
  const sharedTools = toolOperations.map((pair) => {
    const [operationKey, name] = pair.split(":")
    const definition = operations[operationKey]
    return {
      name,
      shareable: true,
      description: definition.title,
      inputSchema: definition.input,
      annotations: readOnlyTools.has(name) ? { readOnlyHint: true } : undefined,
      execute: async (input, context, signal) => {
        try {
          const { value } = await definition.execute(input, context, signal)
          return { content: [{ type: "text", text: JSON.stringify(value) }] }
        } catch (error) {
          const errorId = error?.errorId ? ` [${error.errorId}]` : ""
          // AC13-二轮：领域 isError 返回与抛出异常同受出口脱敏（令牌/凭据不进回执）
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: redactSensitive(
                  `${error.code ?? "error"}：${error.issue?.safeMessage || error.message}${errorId}${error.issue?.traceId ? ` [traceId=${error.issue.traceId}]` : ""}`
                ),
              },
            ],
          }
        }
      },
    }
  })

  return {
    operations,
    sharedTools,
    close() {
      if (!closing) {
        lifetime.abort()
        closing = Promise.allSettled([...activeCalls]).then(() => undefined)
      }
      return closing
    },
  }
}

function latestVersion(store, draftId) {
  const row = store.db
    .prepare(
      "SELECT id, draft_id AS draftId, sequence, artifact_id AS artifactId, base_sequence AS baseSequence, actor_id AS actorId, summary, created_at AS createdAt FROM versions WHERE draft_id = ? ORDER BY sequence DESC LIMIT 1"
    )
    .get(draftId)
  if (!row) throw new WorkbenchError("not_found", "草稿尚无版本。")
  return row
}
