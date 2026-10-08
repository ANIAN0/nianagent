import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  HomeComposer,
  type HomeComposerProps,
} from "@/features/home/home-composer"
import { ConversationComposer } from "@/features/conversation/composer/conversation-composer"
import type {
  ComposerData,
  ComposerDraft,
  Material,
} from "@/lib/composer/types"
import type {
  HomeDraftStore,
  HomeSubmission,
} from "@/features/conversation/conversation-draft-store"
import {
  followingHomeDraft,
  recoverRejectedHomeDraft,
  withHomeDraftRecovery,
  type HomeDraftRecovery,
} from "@/features/home/home-submission-draft"
import {
  SessionServiceContext,
  type SessionService,
} from "@/features/session/session-service"
import {
  MaterialServiceContext,
  type MaterialService,
} from "@/features/materials/material-service"
import {
  PermissionServiceContext,
  type PermissionService,
} from "@/features/conversation/permissions/permission-service"
import { ExtensionServiceContext } from "@/features/extensions/extension-service"
import type {
  MaterialReference,
  SessionCatalog,
  SessionConfiguration,
  ConversationPermission,
} from "@/contracts/rpc.generated"
import { Button } from "@/components/ui/button"
import { sortMaterialCatalogFiles } from "../../backend/material-catalog-sort.mjs"
import { createExtensionFixtureService } from "./extensions"
import imageUrl from "../../src-tauri/icons/Square89x89Logo.png?inline"

export type HomeScenario =
  | "normal"
  | "workspace-cancel"
  | "workspace-empty"
  | "workspace-empty-cancel"
  | "workspace-empty-choose-error"
  | "workspace-empty-read-error"
  | "workspace-empty-pending"
  | "workspace-pending"
  | "workspace-error"
  | "workspace-unavailable"
  | "workspace-long"
  | "permission-read-error"
  | "permission-set-error"
  | "permission-read-pending"
  | "permission-set-pending"
  | "model-error"
  | "model-pending"
  | "model-empty"
  | "model-long"
  | "config-read-error"
  | "config-save-error"
  | "config-read-pending"
  | "config-save-pending"
  | "config-no-instructions"
  | "config-long-instructions"
  | "config-instruction-changes"
  | "config-long-tools"
  | "config-tool-changes"
  | "text-long"
  | "send-error"
  | "send-pending"
  | "send-unknown"
  | "send-recovery-pending"
  | "send-recovery-auto-pending"
  | "send-recovery-manual-pending"
  | "resource-error"
  | "resource-empty"
  | "resource-pending"
  | "resource-long"
  | "file-ranking"
  | "skill-long"
  | "skill-legacy-draft"
  | "prepare-error"
  | "prepare-pending"
  | "attachment-cancel"
  | "preview-error"
  | "preview-layout"
  | "preview-pending"
  | "preview-decode"
  | "thumbnail-error"
  | "upload-restore"
  | "file-reselect"
  | "attachment-many"
  | "image-incompatible"

const workspaces = [
  { id: "demo-moon", name: "moon", path: "H:/演示工作区/moon" },
  { id: "demo-notes", name: "notes", path: "H:/演示工作区/notes" },
]
const instructionWorkspacePath =
  "H:/演示工作区/首页输入组件的AGENTS.md加载范围演示/包含中文与空格的长期维护目录/moon"
const tools: SessionCatalog["tools"] = [
  {
    id: "read",
    name: "读取文件",
    description: "读取文本与图片内容",
    group: "Pi 内置工具",
    detail: "读取工作目录内指定文件；执行时仍受权限限制。",
    available: true,
    unavailableReason: "",
  },
  {
    id: "edit",
    name: "编辑文件",
    description: "按精确文本替换文件内容",
    group: "Pi 内置工具",
    detail: "按旧文本查找并替换；找不到时不修改文件。",
    available: true,
    unavailableReason: "",
  },
  {
    id: "bash",
    name: "Bash 命令",
    description: "在工作目录中运行命令",
    group: "Pi 内置工具",
    detail: "运行命令并返回输出；具体操作由会话权限限制。",
    available: true,
    unavailableReason: "",
  },
  {
    id: "powershell",
    name: "PowerShell 命令",
    description: "执行 PowerShell 命令",
    group: "Pi 内置工具",
    detail: "依赖本机 PowerShell。",
    available: false,
    unavailableReason: "演示环境未安装 PowerShell",
  },
]
const longTools: SessionCatalog["tools"] = [
  {
    id: "extension-inspect",
    name: "目录检查",
    description: "检查工作目录中的文档索引与内容，保留完整来源和操作列。",
    group: "工作目录扩展",
    detail: "目录检查：初始说明，版本1。\n检查目录中的文档索引与文件内容。",
    available: true,
    unavailableReason: "",
  },
  ...Array.from({ length: 14 }, (_, index) => ({
    id: `document-tool-${index + 1}`,
    name:
      index === 0
        ? "workspace_document_consistency_inspector_with_an_extra_long_name"
        : `文档与跨目录内容一致性检查工具-${index + 1}`,
    description:
      "读取多个目录中的文档和索引，检查引用、名称及内容是否一致。较长用途完整换行，继续使用同一组选择、来源和操作列。",
    group:
      index % 3 === 0
        ? "本地文档维护与多层目录结构检查扩展的完整来源名称_with_long_identifier"
        : index % 3 === 1
          ? "工作目录扩展"
          : "MCP 演示服务",
    detail: `文档检查工具 ${index + 1}。\n在工作目录中检查文件与文档索引。\n本场景仅验证会话配置，不执行工具。`,
    available: index % 5 !== 4,
    unavailableReason:
      index % 5 === 4
        ? "演示环境缺少文档索引依赖，无法读取此工具所需的目录信息。\n请在扩展配置完成依赖设置后重新打开会话配置。"
        : "",
  })),
]

function isRecoveryScenario(mode: HomeScenario) {
  return mode.startsWith("send-recovery-")
}

/** Real PNG pixels for the memory service, independent of production rendering. */
function previewImage(shape: "wide" | "tall") {
  const canvas = document.createElement("canvas")
  canvas.width = shape === "wide" ? 1280 : 640
  canvas.height = shape === "wide" ? 720 : 1600
  const context = canvas.getContext("2d")
  if (!context) throw new Error("演示图片无法生成，请重新打开场景。")
  context.fillStyle = "#e9edf4"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#17202f"
  context.font = '600 32px "Source Han Sans SC", sans-serif'
  context.fillText(
    shape === "wide" ? "Moon · 工作区概览" : "项目交付清单",
    40,
    64
  )
  context.fillStyle = "#5b6574"
  context.font = '20px "Source Han Sans SC", sans-serif'
  context.fillText("设计、实现和验证的当前进度", 40, 104)
  if (shape === "wide") {
    const columns = ["待处理", "进行中", "已完成"]
    columns.forEach((name, column) => {
      const left = 40 + column * 408
      context.fillStyle = "#ffffff"
      context.fillRect(left, 144, 384, 536)
      context.fillStyle = "#17202f"
      context.font = '600 24px "Source Han Sans SC", sans-serif'
      context.fillText(name, left + 24, 188)
      ;["输入材料预览", "文件阅读与恢复", "窄窗及键盘操作"].forEach(
        (task, row) => {
          context.fillStyle = "#f8f9fb"
          context.fillRect(left + 24, 216 + row * 136, 336, 112)
          context.fillStyle = "#4176e6"
          context.fillRect(left + 24, 216 + row * 136, 4, 112)
          context.fillStyle = "#17202f"
          context.font = '22px "Source Han Sans SC", sans-serif'
          context.fillText(task, left + 44, 256 + row * 136)
          context.fillStyle = "#5b6574"
          context.font = '18px "Source Han Sans SC", sans-serif'
          context.fillText(
            `阶段 ${column + 1} · 项目 ${row + 1}`,
            left + 44,
            294 + row * 136
          )
        }
      )
    })
  } else {
    ;[
      "明确用户目标",
      "梳理参考设计",
      "确认交互边界",
      "实现正式组件",
      "补齐失败恢复",
      "检查窄窗主题",
      "验证连续操作",
      "交付实际结果",
    ].forEach((name, index) => {
      const top = 144 + index * 176
      context.fillStyle = "#ffffff"
      context.fillRect(40, top, 560, 148)
      context.fillStyle = "#4176e6"
      context.fillRect(40, top, 8, 148)
      context.fillStyle = "#17202f"
      context.font = '600 26px "Source Han Sans SC", sans-serif'
      context.fillText(`${index + 1}. ${name}`, 72, top + 52)
      context.fillStyle = "#5b6574"
      context.font = '20px "Source Han Sans SC", sans-serif'
      context.fillText("保留正文和材料，逐项确认结束结果。", 72, top + 96)
    })
  }
  return canvas.toDataURL("image/png")
}

const longPreviewText = [
  "# 工作区阅读说明",
  "",
  "本文件用于查看完整原文、换行和段落。预览不会修改文件。",
  "",
  ...Array.from({ length: 24 }, (_, index) => [
    `## ${index + 1}. 材料与输入的核对`,
    "检查正文中的任务描述、附件来源和本次需要查看的内容。",
    "  - 图片保留发送时内容。",
    "  - 文件引用保留实际路径，阅读时显示当前文件。",
    "",
  ]).flat(),
  "文档结束：关闭阅读区后继续编辑原消息。",
].join("\n")

function createEnvironment(mode: HomeScenario) {
  let version = 0
  let released = false
  const listeners = new Set<() => void>()
  const events: { operation: string; data: unknown }[] = []
  const submissions: ComposerDraft[] = []
  const drafts = new Map<string, Partial<ComposerDraft>>()
  const configurations = new Map<string, SessionConfiguration>()
  const permissions = new Map<string, ConversationPermission>()
  const references = new Map<string, MaterialReference>()
  const failures = new Set<string>()
  const calls = new Map<string, number>()
  const gates = new Set<() => void>()
  let previewTarget: MaterialReference | undefined
  let armedPreviewFailure: string | undefined
  let thumbnailFailure: string | undefined
  let armedPreviewWait: string | undefined
  let armedDecodeFailure: string | undefined
  const previewImages = new Map<string, string>()
  const previewTexts = new Map<string, string>()
  let fileSelectionFailed = false
  const instructionChangeScenario = mode === "config-instruction-changes"
  const toolChangeScenario = mode === "config-tool-changes"
  let scenarioTools =
    mode === "config-long-tools" || toolChangeScenario
      ? [...tools, ...longTools].map((tool) =>
          toolChangeScenario && tool.id === "extension-inspect"
            ? { ...tool, group: "目录检查扩展" }
            : tool
        )
      : tools
  let toolCatalogRevision = 0
  let instructionDiskRevision = 0
  let unconfirmedDraft: ComposerDraft | undefined
  let recoverySubmission: HomeSubmission | undefined
  let recoveryMetadata: HomeDraftRecovery | undefined
  let recoveryPhase: "editing" | "captured" | "delivered" = "editing"
  let replayedRecovery: HomeComposerProps["restoredSubmission"]
  let recoveryCheckCount = 0
  const recoveryCheck =
    mode === "send-recovery-auto-pending" ||
    mode === "send-recovery-manual-pending"
  const unknownResult = () => ({
    issue: {
      code: "result_unknown",
      summary: "原消息接收结果暂未确认，下一稿已保留。",
      severity: "warning",
      recovery: "check",
    },
  })
  const publish = () => {
    version++
    listeners.forEach((listener) => listener())
  }
  const record = (operation: string, data?: unknown) => {
    events.push({ operation, data: data ?? null })
    publish()
  }
  const delay = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted()
      const finish = () => {
        signal?.removeEventListener("abort", abort)
        resolve()
      }
      const timer = setTimeout(finish, 240)
      const abort = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
      }
      signal?.addEventListener("abort", abort, { once: true })
    })
  const wait = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted()
      const finish = () => {
        gates.delete(finish)
        signal?.removeEventListener("abort", abort)
        resolve()
      }
      const abort = () => {
        gates.delete(finish)
        signal?.removeEventListener("abort", abort)
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
      }
      gates.add(finish)
      signal?.addEventListener("abort", abort, { once: true })
      publish()
    })
  async function checkpoint(operation: string, signal?: AbortSignal) {
    const count = (calls.get(operation) ?? 0) + 1
    calls.set(operation, count)
    const configDialogRead = operation === "config-read" && count > 1
    const applicable = operation !== "config-read" || configDialogRead
    if (applicable && mode === `${operation}-pending` && !released)
      await wait(signal)
    else await delay(signal)
    if (
      applicable &&
      mode === `${operation}-error` &&
      !failures.has(operation)
    ) {
      failures.add(operation)
      record(`${operation}.failed`)
      throw new Error(
        {
          "permission-read": "权限未能读取，请重新读取。",
          "permission-set": "权限未能保存，原权限仍有效。",
          "config-read": "会话配置未能读取，请重新读取。",
          "config-save": "会话配置未能保存，候选改动仍在。",
          resource: "资源列表未能读取，请重新读取。",
          prepare: "材料未能准备，请重试。",
          preview: "预览未能读取，请重试。",
          send: "消息未能发送，草稿已保留。",
        }[operation] ?? "演示操作失败，可重试。"
      )
    }
    signal?.throwIfAborted()
  }
  // Literal synthetic IDs satisfy the service contract; no file hashing takes place.
  let sequence = 0
  const identity = () => (++sequence).toString(16).padStart(64, "0")
  const reference = (
    source: string,
    type: MaterialReference["type"],
    name?: string
  ): MaterialReference => {
    const item: MaterialReference = {
      id: identity(),
      name: name ?? source.split("/").pop()!,
      kind: type === "skill" ? "Skill" : "附件",
      type,
      status: "ready",
      source,
      ...(type === "skill"
        ? {
            name: name ?? "review",
            description:
              name === "plan"
                ? "整理本次任务的执行计划"
                : "检查改动的正确性、遗漏与影响",
          }
        : { description: source.replace(workspaces[0].path + "/", "") }),
      ...(type === "image"
        ? { mimeType: "image/png", bytes: 840, thumbnail: imageUrl }
        : {}),
    }
    references.set(item.id, item)
    return item
  }
  const file = reference(`${workspaces[0].path}/README.md`, "file")
  const selectRepairableFile = () => {
    const selected = { ...file, id: identity() }
    if (!fileSelectionFailed) {
      fileSelectionFailed = true
      Object.assign(selected, {
        status: "failed",
        error: "文件来源暂不可读取，请重新选择或检查。",
        retryable: true,
      })
    }
    references.set(selected.id, selected)
    return selected
  }
  const nestedFile = reference(
    `${workspaces[0].path}/src/features/home/home-composer.tsx`,
    "file"
  )
  const directory = reference(`${workspaces[0].path}/docs`, "directory")
  const guideFile = reference(`${workspaces[0].path}/docs/guide.md`, "file")
  const nestedDirectory = reference(
    `${workspaces[0].path}/docs/详细说明`,
    "directory"
  )
  const skill = reference(
    `${workspaces[0].path}/.agents/skills/review/SKILL.md`,
    "skill"
  )
  const planSkill = reference(
    `${workspaces[0].path}/.agents/skills/plan/SKILL.md`,
    "skill",
    "plan"
  )
  const longSkillName = "review-frontend-accessibility-and-material-handling"
  const longSkill = reference(
    `${workspaces[0].path}/.agents/skills/${longSkillName}/SKILL.md`,
    "skill",
    longSkillName
  )
  const longFile = reference(
    `${workspaces[0].path}/docs/详细说明/含 空格的目录/首页输入框与文件引用流程的完整验收说明及恢复操作记录.md`,
    "file"
  )
  const rankingFiles =
    mode === "file-ranking"
      ? [
          ...Array.from({ length: 70 }, (_, index) =>
            reference(
              `${workspaces[0].path}/a-README.md-path/${String(index).padStart(2, "0")}.txt`,
              "file"
            )
          ),
          reference(`${workspaces[0].path}/z-last/README.md`, "file"),
          reference(`${workspaces[0].path}/README.md.backup`, "file"),
          reference(`${workspaces[0].path}/copy-README.md.txt`, "file"),
          file,
          nestedFile,
          directory,
          guideFile,
          nestedDirectory,
          longFile,
        ]
      : [file, nestedFile, directory, guideFile, nestedDirectory, longFile]
  const defaults = {
    toolIds: ["read", "edit"],
    instructionScope: "all" as const,
  }
  const instructionFiles = (cwd: string): SessionCatalog["instructions"] => {
    if (mode === "config-no-instructions") return []
    if (mode === "config-long-instructions" || instructionChangeScenario) {
      const parent = cwd.slice(0, cwd.lastIndexOf("/"))
      return [
        {
          path: "H:/演示个人配置/用于验证很长路径与同名文件来源的中文个人配置目录/AGENTS.md",
          source: "global",
          content: "个人指令：使用中文回答，修改前说明范围。",
        },
        {
          path: `${parent}/AGENTS.md`,
          source: "directory",
          content: instructionDiskRevision
            ? "# 目录规则\n版本2：文件正文已修改，工具与加载范围保持原选择。"
            : "# 目录规则\n版本1：首次应用保存的正文。",
        },
        ...(instructionDiskRevision >= 2
          ? []
          : [
              {
                path: `${cwd}/AGENTS.md`,
                source: "directory" as const,
                content:
                  "# 当前目录规则\n本文件与上级目录同名，使用完整路径区分。",
              },
            ]),
        ...(mode === "config-long-instructions"
          ? [
              {
                path: `${parent}/CLAUDE.md`,
                source: "directory" as const,
                content: "服务返回的其他指令文件仍按真实路径显示。",
              },
            ]
          : []),
      ]
    }
    return [
      {
        path: "H:/演示个人配置/AGENTS.md",
        source: "global",
        content: "使用中文回答，修改前说明范围。",
      },
      {
        path: `${cwd}/AGENTS.md`,
        source: "directory",
        content: "只修改当前任务涉及的文件。",
      },
    ]
  }
  const catalog = (cwd: string): SessionCatalog => ({
    cwd,
    tools: scenarioTools,
    defaults,
    instructions: instructionFiles(cwd),
  })
  const session: SessionService = {
    catalog: async (cwd, signal) => {
      record("session.catalog", { cwd })
      await checkpoint("config-read", signal)
      // A real first apply establishes the baseline. Reopening next changes
      // only content; another reopening then removes a path, without auto-apply.
      if (
        instructionChangeScenario &&
        configurations.size > 0 &&
        (calls.get("config-read") ?? 0) >= 3
      ) {
        const nextRevision = (calls.get("config-read") ?? 0) >= 4 ? 2 : 1
        if (nextRevision !== instructionDiskRevision) {
          instructionDiskRevision = nextRevision
          record("demo.instructions.changed", {
            cwd,
            revision: instructionDiskRevision,
            ...(instructionDiskRevision >= 2
              ? { removedPath: `${cwd}/AGENTS.md` }
              : {
                  contentChangedPath: `${cwd.slice(0, cwd.lastIndexOf("/"))}/AGENTS.md`,
                }),
          })
        }
      }
      if (toolChangeScenario && (calls.get("config-read") ?? 0) >= 3) {
        const nextRevision = (calls.get("config-read") ?? 0) >= 4 ? 2 : 1
        if (nextRevision !== toolCatalogRevision) {
          toolCatalogRevision = nextRevision
          scenarioTools =
            nextRevision === 1
              ? scenarioTools.map((tool) =>
                  tool.id === "extension-inspect"
                    ? {
                        ...tool,
                        description:
                          "目录检查用途已更新，版本2；依赖暂不可用。",
                        detail:
                          "目录检查：新说明，版本2。\n扩展依赖已失效，当前不能新增选择。",
                        available: false,
                        unavailableReason:
                          "内存扩展环境未加载文档索引依赖。已选工具可以取消选择，未选工具不能新增。",
                      }
                    : tool
                )
              : scenarioTools.filter((tool) => tool.id !== "extension-inspect")
          record("demo.tools.changed", {
            id: "extension-inspect",
            revision: toolCatalogRevision,
            ...(nextRevision === 1
              ? { detail: "版本2", available: false }
              : { removed: true }),
          })
        }
      }
      return catalog(cwd)
    },
    read: async (sessionId, signal) => {
      record("session.read", { sessionId })
      await delay(signal)
      return configurations.get(sessionId) ?? null
    },
    apply: async (input, signal) => {
      record("session.apply", input)
      await checkpoint("config-save", signal)
      const configuration: SessionConfiguration = {
        ...input,
        revision: (configurations.get(input.sessionId)?.revision ?? 0) + 1,
        effectiveToolIds: input.toolIds.filter((id) =>
          scenarioTools.some((tool) => tool.id === id && tool.available)
        ),
        unavailableToolIds: input.toolIds.filter(
          (id) =>
            !scenarioTools.some((tool) => tool.id === id && tool.available)
        ),
        instructions: catalog(input.cwd).instructions.filter(
          (item) =>
            input.instructionScope === "all" ||
            (input.instructionScope === "directory" &&
              item.source === "directory")
        ),
      }
      configurations.set(input.sessionId, configuration)
      record("session.applied", configuration)
      return configuration
    },
  }
  const permission: PermissionService = {
    read: async (sessionId, signal) => {
      record("permission.read", { sessionId })
      await checkpoint("permission-read", signal)
      return (
        permissions.get(sessionId) ?? {
          sessionId,
          mode: "workspace",
          revision: 0,
        }
      )
    },
    set: async (current, permissionMode) => {
      record("permission.set", { mode: permissionMode })
      await checkpoint("permission-set")
      const next = {
        ...current,
        mode: permissionMode,
        revision: current.revision + 1,
      }
      permissions.set(current.sessionId, next)
      record("permission.saved", next)
      return next
    },
    reply: async () => {
      throw new Error("首页示例不包含审批回复")
    },
  }
  const materials: MaterialService = {
    catalog: async (_id, cwd, query, signal) => {
      record("material.catalog", { cwd, query })
      await checkpoint("resource", signal)
      const matches = (item: MaterialReference) =>
        `${item.name} ${item.source} ${item.description ?? ""}`
          .replaceAll("\\", "/")
          .toLowerCase()
          .includes(query.replaceAll("\\", "/").toLowerCase())
      const inDirectory = (item: MaterialReference) =>
        cwd === workspaces[0].path
          ? item
          : {
              ...reference(
                item.source.replace(workspaces[0].path, cwd),
                item.type,
                item.name
              ),
              description: item.description,
            }
      const browsing = query.replaceAll("\\", "/").endsWith("/")
      const candidates = (mode === "resource-long" ? [longFile] : rankingFiles)
        .map(inDirectory)
        .filter((item) => {
          if (!browsing) return matches(item)
          const path = (item.description ?? "").replaceAll("\\", "/")
          return (
            path.slice(0, path.lastIndexOf("/") + 1).toLowerCase() ===
            query.replaceAll("\\", "/").toLowerCase()
          )
        })
      return {
        cwd,
        files:
          mode === "resource-empty"
            ? []
            : sortMaterialCatalogFiles(candidates, query).slice(0, 60),
        skills:
          mode === "resource-empty"
            ? []
            : (mode === "skill-long" ? [longSkill] : [skill, planSkill])
                .map(inDirectory)
                .filter(matches),
        diagnostics:
          candidates.length > 60
            ? [
                {
                  scope: "files",
                  message: "文件结果有数量限制，请输入更具体的相对路径。",
                },
              ]
            : [],
        commands: [
          {
            name: "compact",
            description: "压缩上下文",
            kind: "host",
            available: false,
            reason: "新会话无上下文，请先打开已有会话",
          },
          {
            name: "echo",
            description: "演示已注册扩展命令（只核对首页回调）",
            kind: "extension",
            available: true,
          },
        ],
      }
    },
    prepare: async (_id, cwd, paths, signal, options) => {
      record("material.prepare", { cwd, paths, options })
      try {
        await checkpoint("prepare", signal)
      } catch (failure) {
        if (signal?.aborted) throw failure
        const selected = [...references.values()].find((item) =>
          paths.includes(item.source)
        )
        if (selected?.type === "file" || selected?.type === "directory")
          throw new Error(
            `${selected.type === "directory" ? "目录" : "文件"}来源暂不可读取，请重新检查。`,
            { cause: failure }
          )
        throw failure
      }
      return paths.map((path) => {
        if (mode === "file-reselect" && path === file.source) {
          const item = selectRepairableFile()
          record("material.prepared", item)
          return item
        }
        const original = [...references.values()].find(
          (item) => item.source === path
        )
        if (!original) throw new Error("演示目录没有该材料，请重新选择。")
        const item = { ...original, id: identity() }
        references.set(item.id, item)
        record("material.prepared", item)
        return item
      })
    },
    choose: async (_id, cwd, signal) => {
      record("material.choose", { cwd })
      await checkpoint("prepare", signal)
      if (mode === "attachment-cancel") {
        record("material.choose.cancelled")
        return []
      }
      if (mode === "file-reselect") {
        const firstSelection = !fileSelectionFailed
        const selected = selectRepairableFile()
        const items = firstSelection
          ? [reference(`${cwd}/说明.md`, "file", "说明.md"), selected]
          : [selected]
        record("material.chosen", items)
        return items
      }
      await document.fonts.ready
      signal?.throwIfAborted()
      const imageData = previewImage("wide")
      const image: MaterialReference = {
        ...reference("演示选择的图片", "image", "首页设计.png"),
        thumbnail: imageData,
        bytes: atob(imageData.split(",")[1]!).length,
      }
      previewImages.set(image.id, imageData)
      references.set(image.id, image)
      if (mode === "preview-layout") {
        const small = reference("演示选择的小图", "image", "小图标.png")
        const tallData = previewImage("tall")
        const tall = {
          ...reference("演示选择的长图", "image", "交付清单.png"),
          thumbnail: tallData,
          bytes: atob(tallData.split(",")[1]!).length,
        }
        previewImages.set(tall.id, tall.thumbnail)
        references.set(tall.id, tall)
        const shortFile = { ...reference(`${cwd}/说明.md`, "file"), bytes: 192 }
        const longFile = {
          ...reference(
            `${cwd}/${"文档与设计说明/".repeat(12)}阅读记录与完整来源路径.txt`,
            "file"
          ),
          bytes: new TextEncoder().encode(longPreviewText).length,
        }
        references.set(shortFile.id, shortFile)
        references.set(longFile.id, longFile)
        previewTexts.set(longFile.id, longPreviewText)
        const items = [small, image, tall, shortFile, longFile]
        record("material.chosen", items)
        return items
      }
      if (mode === "preview-error" || mode === "thumbnail-error")
        delete image.thumbnail
      previewTarget = image
      if (mode === "thumbnail-error" && !failures.has("thumbnail"))
        thumbnailFailure = image.id
      const file = {
        ...reference(`${cwd}/说明.md`, "file", "说明.md"),
        bytes: 192,
      }
      references.set(file.id, file)
      record("material.chosen", [image, file])
      return [image, file]
    },
    upload: async (_id, cwd, upload, signal) => {
      record("material.upload", {
        cwd,
        name: upload.name,
        mimeType: upload.mimeType,
      })
      await checkpoint("prepare", signal)
      if (mode === "upload-restore" && !failures.has("upload")) {
        failures.add("upload")
        record("upload.failed")
        throw new Error("图片上传暂时失败，请重试。")
      }
      const item = {
        ...reference("粘贴或拖入的图片", "image", upload.name),
        mimeType: upload.mimeType,
        thumbnail: `data:${upload.mimeType};base64,${upload.data}`,
      }
      references.set(item.id, item)
      record("material.uploaded", { ...item, thumbnail: "（图片数据略）" })
      return item
    },
    restore: async (_id, cwd, values, signal) => {
      record("material.restore", { cwd, ids: values.map((item) => item.id) })
      await delay(signal)
      return values.map(
        (item) =>
          references.get(item.id) ?? {
            ...item,
            type: item.type ?? "file",
            source: item.source ?? "",
            status: "failed",
            error: "材料标识无效，请重新选择。",
            retryable: false,
          }
      )
    },
    preview: async (_cwd, id, signal) => {
      record("material.preview", { id })
      // The dialog fault is armed only after the real thumbnail has settled.
      // Neither a call count nor a production-only purpose parameter is needed.
      await delay(signal)
      if (armedPreviewWait === id) {
        armedPreviewWait = undefined
        record("dialog.preview.waiting", { id })
        await wait(signal)
      }
      if (thumbnailFailure === id || armedPreviewFailure === id) {
        const operation = thumbnailFailure === id ? "thumbnail" : "dialog"
        thumbnailFailure = undefined
        armedPreviewFailure = undefined
        failures.add(operation)
        record(`${operation}.preview.failed`, { id })
        throw new Error("预览未能读取，请重试。")
      }
      const item = references.get(id)
      if (!item) throw new Error("材料标识无效，请重新选择。")
      return {
        id,
        name: item.name,
        source: item.source,
        label:
          item.type === "image"
            ? "待发送图片"
            : item.type === "skill"
              ? "本次 Skill 内容"
              : item.type === "directory"
                ? "当前目录"
                : "当前文件",
        content:
          item.type === "skill"
            ? "# Review\n检查改动、调用方与需求。"
            : item.type === "directory"
              ? "guide.md\n详细说明/"
              : (previewTexts.get(id) ?? "# Moon\n首页输入相关示例文件。"),
        mimeType: item.mimeType ?? "",
        data:
          item.type === "image"
            ? armedDecodeFailure === id
              ? (() => {
                  armedDecodeFailure = undefined
                  return "invalid-image-data"
                })()
              : ((previewImages.get(id) ?? item.thumbnail ?? imageUrl).split(
                  ","
                )[1] ?? "")
            : "",
        truncated: false,
      }
    },
  }
  const draftStore: HomeDraftStore = {
    read: (id) => drafts.get(id) ?? { sessionId: crypto.randomUUID() },
    write: (draft) => {
      drafts.set(draft.workspaceId, structuredClone(draft))
    },
  }
  const recoveryError = () => {
    if (!recoveryMetadata)
      throw new Error("请先冻结拒绝结果，再交付给正式组件。")
    return withHomeDraftRecovery(
      new Error("演示原提交已明确拒绝，原输入与下一稿需要恢复。"),
      structuredClone(recoveryMetadata)
    )
  }
  return {
    session,
    permission,
    materials,
    draftStore,
    events,
    submissions,
    get tools() {
      return scenarioTools
    },
    subscribe: (callback: () => void) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    snapshot: () => version,
    get released() {
      return released
    },
    get pending() {
      return gates.size
    },
    get previewTarget() {
      return previewTarget
    },
    armPreviewFailure: () => {
      if (!previewTarget) return
      armedPreviewFailure = previewTarget.id
      record("dialog.preview.failure-armed")
    },
    armPreviewWait: () => {
      if (!previewTarget) return
      released = false
      armedPreviewWait = previewTarget.id
      record("dialog.preview.wait-armed")
    },
    armDecodeFailure: () => {
      if (!previewTarget) return
      armedDecodeFailure = previewTarget.id
      record("dialog.preview.decode-failure-armed")
    },
    record,
    prepareSubmission: (
      submission: HomeSubmission,
      following: ComposerDraft
    ) => {
      // Capture the actual immutable Home copy, including its request identity.
      recoverySubmission ??= structuredClone(submission)
      draftStore.write(submission.originalDraft ?? submission.draft)
      draftStore.write(following)
      record("home.prepared", submission)
    },
    get restoredSubmission() {
      return replayedRecovery
    },
    get recoveryReady() {
      return !!recoverySubmission
    },
    get recoveryAction() {
      return {
        editing: "冻结拒绝结果（Alt+Shift+R）",
        captured: "交付旧拒绝结果（Alt+Shift+R）",
        delivered: "重放同一恢复通知（Alt+Shift+R）",
      }[recoveryPhase]
    },
    advanceRecovery: () => {
      if (!recoverySubmission) return
      if (recoveryPhase === "editing") {
        recoveryMetadata = recoverRejectedHomeDraft(recoverySubmission, {
          ...followingHomeDraft(recoverySubmission.draft),
          ...draftStore.read(recoverySubmission.draft.workspaceId),
        })
        recoveryPhase = "captured"
        record("demo.recovery.metadata", {
          clientRequestId: recoverySubmission.clientRequestId,
          recovery: recoveryMetadata,
        })
      } else if (recoveryPhase === "captured") {
        recoveryPhase = "delivered"
        released = true
        gates.forEach((finish) => finish())
        record("demo.recovery.deliver", {
          clientRequestId: recoverySubmission.clientRequestId,
          recovery: recoveryMetadata,
        })
      } else {
        replayedRecovery = {
          submission: recoverySubmission,
          feedback: {
            message: "演示重放同一原提交的拒绝通知，当前输入继续保留。",
            code: "operation_failed",
            recovery: "none",
            severity: "warning",
          },
        }
        record("demo.recovery.replay", {
          clientRequestId: recoverySubmission.clientRequestId,
        })
      }
    },
    release: () => {
      released = true
      gates.forEach((finish) => finish())
      record("demo.release")
    },
    chooseWorkspace: async (signal: AbortSignal) => {
      record("workspace.choose")
      await delay(signal)
      if (mode === "workspace-cancel" || mode === "workspace-empty-cancel") {
        record("workspace.choose.cancelled")
        return null
      }
      if (
        mode === "workspace-empty-choose-error" &&
        events.filter((event) => event.operation === "workspace.choose")
          .length === 1
      ) {
        record("workspace.choose.failed")
        throw new Error("演示目录选择失败，请重新选择。")
      }
      return {
        id: "demo-added",
        name: "project",
        path: "H:/演示工作区/project",
      }
    },
    selectWorkspace: async (id: string, signal?: AbortSignal) => {
      record("workspace.select", { id })
      await delay(signal)
    },
    submit: async (draft: ComposerDraft, signal?: AbortSignal) => {
      record("home.submit", draft)
      if (mode === "send-recovery-pending" && !failures.has("recovery-send")) {
        await wait(signal)
        failures.add("recovery-send")
        record("home.rejected", recoveryMetadata)
        throw recoveryError()
      }
      await checkpoint("send", signal)
      if (
        draft.materials.some(
          (item) => item.status !== "ready" || !references.has(item.id)
        )
      )
        throw new Error("材料标识无效，请重新选择。")
      if ((mode === "send-unknown" || recoveryCheck) && !unconfirmedDraft) {
        unconfirmedDraft = structuredClone(draft)
        record("home.result_unknown", { sessionId: draft.sessionId })
        throw unknownResult()
      }
      submissions.push(structuredClone(draft))
      record("home.accepted", draft)
      return "演示提交已接收；示例到首页提交回调结束。"
    },
    checkSubmission: async (sessionId: string, signal?: AbortSignal) => {
      record("home.check", { sessionId })
      if (recoveryCheck) {
        recoveryCheckCount++
        if (
          mode === "send-recovery-manual-pending" &&
          recoveryCheckCount <= 3
        ) {
          await delay(signal)
          throw unknownResult()
        }
        if (!released) await wait(signal)
        record("home.check.rejected", {
          count: recoveryCheckCount,
          recovery: recoveryMetadata,
        })
        throw recoveryError()
      }
      await delay(signal)
      if (!released || unconfirmedDraft?.sessionId !== sessionId)
        throw unknownResult()
      if (!submissions.some((draft) => draft.sessionId === sessionId)) {
        submissions.push(structuredClone(unconfirmedDraft))
        record("home.accepted", unconfirmedDraft)
      }
      // The fixture stops at the Home callback; it does not claim a real route handoff.
    },
    seedImages: (count: number): Material[] =>
      Array.from({ length: count }, (_, index) =>
        reference(
          `布局边界图片 ${index + 1}`,
          "image",
          `参考图-${index + 1}.png`
        )
      ),
    seedLegacySkillDraft: (): Pick<
      ComposerDraft,
      "text" | "model" | "materials"
    > => ({
      text: "/skill:review 检查原稿参数 @README.md 句内 /skill:plan 保留文字。",
      model: "vision/demo",
      materials: [
        {
          ...skill,
          status: "failed",
          error: "旧 Skill 准备失败",
          retryable: true,
        },
        file,
        reference("原稿参考图.png", "image", "原稿参考图.png"),
      ],
    }),
  }
}

/** Always mount the formal full composer. Only host service boundaries are substituted. */
export function HomeStoryExample({
  scenario = "normal",
  consumer = "home",
  conversationRunning = false,
}: {
  scenario?: HomeScenario
  consumer?: "home" | "conversation"
  conversationRunning?: boolean
}) {
  const [environment] = useState(() => createEnvironment(scenario))
  const [materialService, setMaterialService] = useState(environment.materials)
  const [composerRevision, setComposerRevision] = useState(0)
  const composerContainer = useRef<HTMLDivElement>(null)
  const [thumbnailSettled, setThumbnailSettled] = useState(false)
  useEffect(() => {
    if (
      !["preview-error", "preview-pending", "preview-decode"].includes(scenario)
    )
      return
    const container = composerContainer.current
    if (!container) return
    const check = () => {
      const name = environment.previewTarget?.name
      // HoverHint's Slot owns the rendered wrapper's data-slot. Locate the
      // actual preview action; the newest matching image is appended last.
      const card = Array.from(container.querySelectorAll("button"))
        .filter(
          (button) => button.getAttribute("aria-label") === `预览 ${name}`
        )
        .at(-1)?.parentElement
      const image = card?.querySelector("img")
      setThumbnailSettled(
        !!(
          (image?.complete && image.naturalWidth > 0) ||
          card?.querySelector('[data-status="failed"]')
        )
      )
    }
    const observer = new MutationObserver(check)
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
    })
    container.addEventListener("load", check, true)
    container.addEventListener("error", check, true)
    check()
    return () => {
      observer.disconnect()
      container.removeEventListener("load", check, true)
      container.removeEventListener("error", check, true)
    }
  }, [environment, scenario])
  const [extensionService] = useState(() => createExtensionFixtureService())
  useEffect(() => {
    if (!scenario.endsWith("pending")) return
    const finishWaiting = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        event.shiftKey &&
        event.code === "KeyR" &&
        !event.repeat &&
        (isRecoveryScenario(scenario) || !environment.released)
      ) {
        event.preventDefault()
        if (isRecoveryScenario(scenario)) environment.advanceRecovery()
        else environment.release()
      }
    }
    window.addEventListener("keydown", finishWaiting)
    return () => window.removeEventListener("keydown", finishWaiting)
  }, [environment, scenario])
  useSyncExternalStore(environment.subscribe, environment.snapshot)
  const [workspaceStatus, setWorkspaceStatus] = useState(
    scenario === "workspace-error" || scenario === "workspace-empty-read-error"
      ? "error"
      : "ready"
  )
  const [modelStatus, setModelStatus] = useState<"ready" | "loading" | "error">(
    scenario === "model-error"
      ? "error"
      : scenario === "model-pending"
        ? "loading"
        : "ready"
  )
  const [seed] = useState(() => ({
    sessionId: crypto.randomUUID(),
    ...(scenario === "text-long"
      ? {
          text: Array.from(
            { length: 30 },
            (_, index) =>
              `第 ${index + 1} 行：检查长正文滚动、工具栏可达以及发送数据完整。`
          ).join("\n"),
        }
      : {}),
    ...(scenario === "attachment-many"
      ? { materials: environment.seedImages(8) }
      : {}),
    ...(scenario === "image-incompatible"
      ? { materials: environment.seedImages(1), text: "描述这张图片" }
      : {}),
    ...(scenario === "skill-legacy-draft"
      ? environment.seedLegacySkillDraft()
      : {}),
  }))
  const [otherOwner, setOtherOwner] = useState(false)
  const [otherSessionId] = useState(() => crypto.randomUUID())
  const modelLoadingReleased =
    scenario === "model-pending" && environment.released
  const scenarioTools = environment.tools
  const data = useMemo<
    Pick<
      ComposerData,
      | "workspaces"
      | "models"
      | "modelLabels"
      | "modelThinking"
      | "modelInputs"
      | "modelCatalog"
      | "materials"
      | "materialsEnabled"
      | "tools"
    >
  >(() => {
    const availableModels =
      scenario === "model-empty"
        ? []
        : [
            "deepseek/demo",
            "vision/demo",
            "fast/demo",
            "balanced/demo",
            "long/demo",
          ]
    return {
      workspaces: scenario.startsWith("workspace-empty")
        ? []
        : workspaces.map((item, index) => ({
            ...item,
            ...(scenario === "workspace-long" && index === 0
              ? { name: "首页输入组件标准与功能验证使用的完整演示工作目录" }
              : {}),
            ...((scenario === "config-long-instructions" ||
              scenario === "config-instruction-changes") &&
            index === 0
              ? { path: instructionWorkspacePath }
              : {}),
            ...(scenario === "workspace-unavailable" && index === 0
              ? {
                  available: false,
                  unavailableReason: "演示目录已不可用，请选择 notes。",
                }
              : {}),
          })),
      models: availableModels,
      modelLabels: {
        "deepseek/demo":
          scenario === "model-long"
            ? "DeepSeek-V4-Flash-完整连接与模型名称演示"
            : "DeepSeek-V4-Flash",
        "vision/demo": "Vision 示例",
        "fast/demo": "Fast 示例",
        "balanced/demo": "Balanced 示例",
        "long/demo": "Long Context 示例",
      },
      modelThinking: {
        "deepseek/demo": ["off", "low", "medium", "high"],
        "vision/demo": ["off", "high"],
        "fast/demo": ["off"],
        "balanced/demo": ["off", "medium"],
        "long/demo": ["off", "high"],
      },
      modelInputs: {
        "deepseek/demo": ["text"],
        "vision/demo": ["text", "image"],
        "fast/demo": ["text"],
        "balanced/demo": ["text"],
        "long/demo": ["text"],
      },
      modelCatalog: {
        status:
          modelLoadingReleased && modelStatus === "loading"
            ? "ready"
            : modelStatus,
        items: availableModels.map((value) => ({
          value,
          name: {
            "vision/demo": "Vision 示例",
            "deepseek/demo":
              scenario === "model-long"
                ? "DeepSeek-V4-Flash-完整连接与模型名称演示"
                : "DeepSeek-V4-Flash",
            "fast/demo": "Fast 示例",
            "balanced/demo": "Balanced 示例",
            "long/demo": "Long Context 示例",
          }[value]!,
          connection: "演示连接",
          modelId: value,
        })),
        error:
          modelStatus === "error"
            ? "模型列表未能读取，请重新读取。"
            : undefined,
        onRetry: () => {
          environment.record("models.retry")
          setModelStatus("ready")
        },
        onOpenSettings: () =>
          environment.record("models.openSettings（边界回调）"),
      },
      materialsEnabled: true,
      materials: [],
      tools: scenarioTools,
    }
  }, [environment, modelStatus, modelLoadingReleased, scenario, scenarioTools])
  const [conversationDraft, setConversationDraft] = useState<ComposerDraft>(
    () => ({
      workspaceId: workspaces[0]!.id,
      sessionId: seed.sessionId,
      text: "",
      materials: [],
      model: "deepseek/demo",
      thinking: "high",
      session: {
        toolIds: tools.map((tool) => tool.id),
        instructionScope: "all",
      },
    })
  )
  return (
    <SessionServiceContext value={environment.session}>
      <PermissionServiceContext value={environment.permission}>
        <MaterialServiceContext value={materialService}>
          <ExtensionServiceContext value={extensionService}>
            <div className="flex min-h-svh flex-col bg-background text-foreground">
              <div className="flex min-h-[420px] flex-1 items-center justify-center p-4">
                <div ref={composerContainer} className="w-full max-w-[760px]">
                  {consumer === "conversation" ? (
                    <ConversationComposer
                      sessionId={seed.sessionId}
                      workspacePath={workspaces[0]!.path}
                      running={conversationRunning}
                      data={data}
                      draft={conversationDraft}
                      onChange={setConversationDraft}
                      onSubmit={(draft, delivery) =>
                        environment.record("conversation.submit", {
                          draft: structuredClone(draft),
                          delivery,
                        })
                      }
                      onStop={() => environment.record("conversation.stop")}
                    />
                  ) : (
                    <>
                      <div hidden={otherOwner}>
                        <HomeComposer
                          key={composerRevision}
                          inactive={otherOwner}
                          data={data}
                          initialDraft={seed}
                          draftStore={environment.draftStore}
                          onSubmit={environment.submit}
                          onSubmissionPrepare={
                            isRecoveryScenario(scenario)
                              ? environment.prepareSubmission
                              : undefined
                          }
                          restoredSubmission={environment.restoredSubmission}
                          onCheckSubmission={
                            scenario === "send-unknown" ||
                            scenario === "send-recovery-auto-pending" ||
                            scenario === "send-recovery-manual-pending"
                              ? environment.checkSubmission
                              : undefined
                          }
                          onChooseWorkspace={environment.chooseWorkspace}
                          onWorkspaceSelect={environment.selectWorkspace}
                          workspaceLoading={
                            (scenario === "workspace-pending" ||
                              scenario === "workspace-empty-pending") &&
                            !environment.released
                          }
                          workspaceError={
                            workspaceStatus === "error"
                              ? "工作目录列表未能读取，请重新读取。"
                              : undefined
                          }
                          onWorkspaceRetry={() => {
                            environment.record("workspace.retry")
                            setWorkspaceStatus("ready")
                          }}
                        />
                      </div>
                      {otherOwner && (
                        <HomeComposer
                          data={data}
                          initialDraft={{
                            workspaceId: workspaces[1]!.id,
                            sessionId: otherSessionId,
                          }}
                          draftStore={environment.draftStore}
                          onSubmit={environment.submit}
                          restoredSubmission={environment.restoredSubmission}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
              <aside
                className="border-t p-4 text-[13px] leading-5"
                aria-label="演示环境"
              >
                <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                  <span>
                    内存演示 · 正式
                    {consumer === "conversation" ? "会话输入组合" : "首页组件"}
                    {" · 不连接模型"}
                  </span>
                  {isRecoveryScenario(scenario) ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!environment.recoveryReady}
                        onClick={environment.advanceRecovery}
                      >
                        {environment.recoveryAction}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOtherOwner((current) => !current)}
                      >
                        {otherOwner ? "返回原任务" : "切换演示所有者"}
                      </Button>
                    </>
                  ) : (
                    (scenario.endsWith("pending") ||
                      scenario === "send-unknown") && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={environment.released}
                        onClick={environment.release}
                      >
                        {scenario === "send-unknown"
                          ? "模拟接收原提交"
                          : "完成等待（Alt+Shift+R）"}
                      </Button>
                    )
                  )}
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer">
                    演示数据与事件（{eventsCount(environment.events)} 次，已接收{" "}
                    {environment.submissions.length} 次提交）
                  </summary>
                  {scenario === "preview-error" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!thumbnailSettled}
                      onClick={environment.armPreviewFailure}
                    >
                      让下一次图片弹窗读取失败
                    </Button>
                  )}
                  {scenario === "preview-pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!thumbnailSettled}
                      onClick={environment.armPreviewWait}
                    >
                      让下一次图片弹窗等待读取
                    </Button>
                  )}
                  {scenario === "preview-decode" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!thumbnailSettled}
                      onClick={environment.armDecodeFailure}
                    >
                      让下一次图片弹窗无法解码
                    </Button>
                  )}
                  {scenario === "upload-restore" && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setComposerRevision((value) => value + 1)
                        }
                      >
                        重开输入（保留临时图片源）
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // A fresh service instance has no browser File registry.
                          // Saved drafts and fixed host substitutes remain intact.
                          setMaterialService({ ...environment.materials })
                          setComposerRevision((value) => value + 1)
                        }}
                      >
                        模拟重启（不保留临时图片源）
                      </Button>
                    </div>
                  )}
                  <p className="my-2 text-muted-foreground">
                    这里是示例观测区。发送仅核对正式输入组件回调数据；实际路由、Agent
                    执行不在本页范围。
                  </p>
                  <pre
                    className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap"
                    aria-label="服务调用记录"
                  >
                    {JSON.stringify(environment.events, null, 2)}
                  </pre>
                </details>
              </aside>
            </div>
          </ExtensionServiceContext>
        </MaterialServiceContext>
      </PermissionServiceContext>
    </SessionServiceContext>
  )
}

const eventsCount = (events: unknown[]) => events.length
