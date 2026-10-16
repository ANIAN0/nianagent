// Generated from backend/desktop-contract.mjs. Do not edit.
export type BootStage =
  "profile" | "backend" | "storage" | "frontendProfile" | "workbench" | "ready"
export type BootPhase = "starting" | "waitingFrontend" | "failed" | "ready"
export type BootHostMode = "desktop"
export type BootIssue = {
  code: IssueCode
  stage: BootStage
  message: string
  diagnostics: string
}
export type BootCapabilities = { retry: boolean; exit: boolean }
export type BootSnapshot = {
  attemptId: string
  revision: number
  hostMode: BootHostMode
  phase: BootPhase
  stage: BootStage
  storage: StorageInfo | null
  issue: BootIssue | null
  capabilities: BootCapabilities
}
export type BootAttemptInput = { attemptId: string }
export type BootFrontendStage = "profile" | "workbench"
export type BootFrontendInput = {
  attemptId: string
  dataSetId: string
  generation: number
  stage: BootFrontendStage
  ready: boolean
}
export type StartupSelection = "import" | "fresh"
export type StartupPhase =
  | "awaitingConfirmation"
  | "preparing"
  | "ready"
  | "inspecting"
  | "copying"
  | "validating"
  | "committing"
  | "readyToOpen"
  | "failed"
export type StartupFailureStage =
  | "runtime"
  | "target"
  | "source"
  | "inspecting"
  | "copying"
  | "validating"
  | "committing"
  | "opening"
export type StartupIssueCode =
  | "runtimeMissing"
  | "dependencyMissing"
  | "runtimeIncompatible"
  | "sourceBusy"
  | "sourceInvalid"
  | "targetInvalid"
  | "permission"
  | "insufficientSpace"
  | "dataInvalid"
  | "storageIo"
  | "planExpired"
  | "interrupted"
  | "internal"
export type StartupIssue = {
  code: StartupIssueCode
  stage: StartupFailureStage
  message: string
  path: string | null
  retryable: boolean
}
export type StartupCapabilities = {
  chooseDirectory: boolean
  prepare: boolean
  migrate: boolean
  createFresh: boolean
  retry: boolean
  openDiagnostics: boolean
  exit: boolean
  continueStartup: boolean
}
export type StartupSnapshot = {
  revision: number
  operationId: string | null
  planId: string | null
  planExpiresAt: string | null
  phase: StartupPhase
  selection: StartupSelection | null
  sourceDirectory: string
  legacyProfileDirectory: string | null
  targetDirectory: string
  defaultDirectory: string
  retainedCopyDirectories: string[]
  fileCount: number | null
  totalBytes: number | null
  availableBytes: number | null
  completedFiles: number
  copiedBytes: number | null
  issue: StartupIssue | null
  capabilities: StartupCapabilities
}
export type StartupState = StartupSnapshot | null
export type StartupStartInput = { planId: string; targetDirectory: string }
export type StartupOperationInput = { operationId: string }
export type IssueCode =
  | "validation"
  | "permission"
  | "busy"
  | "offline"
  | "signature"
  | "compatibility"
  | "unavailable"
  | "cancelled"
  | "unknown"
  | "internal"
export type RecoveryAction =
  "retry" | "chooseDirectory" | "wait" | "restart" | "none"
export type ActivityKind =
  "conversation" | "request" | "authorization" | "frontend"
export type Activity = {
  id: string
  kind: ActivityKind
  label: string
  sessionId: string | null
  stoppable: boolean
}
export type DesktopIssue = {
  code: IssueCode
  message: string
  recovery: RecoveryAction
  activities: Activity[]
}
export type StorageSource =
  "installation" | "custom" | "developmentDefault" | "developmentEnvironment"
export type StorageDirectoryMapping = { sourceRoot: string; targetRoot: string }
export type StorageInfo = {
  dataDirectory: string
  installDirectory: string
  source: StorageSource
  dataSetId: string
  generation: number
  schemaVersion: number
  legacyCopyRetained: boolean
  retainedCopyDirectories: string[]
  directoryMappings: StorageDirectoryMapping[]
  usedBytes: number
  availableBytes: number | null
}
export type DesktopCapabilities = {
  migrateData: boolean
  openDataDirectory: boolean
  checkUpdates: boolean
  installUpdates: boolean
  unavailableReason: string | null
}
export type MigrationPlan = {
  planId: string
  sourceDirectory: string
  targetDirectory: string
  dataSetId: string
  generation: number
  fileCount: number
  totalBytes: number
  expiresAt: string
  activities: Activity[]
}
export type MaintenanceKind = "none" | "migration" | "update"
export type MaintenancePhase =
  | "idle"
  | "preparing"
  | "flushing"
  | "closing"
  | "waitingForExit"
  | "copying"
  | "validating"
  | "committing"
  | "handedOff"
  | "succeeded"
  | "failed"
  | "unknown"
export type MaintenanceState = {
  operationId: string | null
  revision: number
  kind: MaintenanceKind
  phase: MaintenancePhase
  shutdownStarted: boolean
  writesFrozen: boolean
  sourceDirectory: string | null
  targetDirectory: string | null
  completedFiles: number
  totalFiles: number
  issue: DesktopIssue | null
}
export type UpdatePreferences = { autoCheck: boolean; autoDownload: boolean }
export type UpdateRelease = {
  releaseId: string
  version: string
  notes: string
  publishedAt: string | null
}
export type UpdatePhase =
  | "unavailable"
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "verifying"
  | "ready"
  | "preparing"
  | "handedOff"
  | "succeeded"
  | "failed"
  | "unknown"
export type UpdateState = {
  operationId: string | null
  revision: number
  phase: UpdatePhase
  release: UpdateRelease | null
  downloadedBytes: number
  totalBytes: number | null
  checkedAt: string | null
  issue: DesktopIssue | null
}
export type DesktopSnapshot = {
  revision: number
  version: string
  platform: string
  architecture: string
  development: boolean
  storage: StorageInfo
  capabilities: DesktopCapabilities
  maintenance: MaintenanceState
  update: UpdateState
  updatePreferences: UpdatePreferences
}
export type FlushReason = "migration" | "update"
export type FlushRequest = {
  operationId: string
  nonce: string
  reason: FlushReason
  timeoutMilliseconds: number
}
export type StartupAcknowledgeInput = {
  dataSetId: string
  generation: number
  profileReady: boolean
  message: string | null
}
export type MigrationPrepareInput = { targetDirectory: string }
export type MigrationStartInput = { planId: string; stopActive: boolean }
export type FlushAcknowledgeInput = {
  operationId: string
  nonce: string
  saved: boolean
  blockers: Activity[]
}
export type ReleaseInput = { releaseId: string }
export type UpdateInstallInput = { releaseId: string; stopActive: boolean }
export type CancelInput = { operationId: string }
export type RetainedCopyInput = { index: number }
export type FileOpenInput = { path: string; program: string | null }
export type FileExportInput = { path: string; name: string }
export type InstalledEditor = { name: string; path: string }
export type InstalledEditors = InstalledEditor[]
export type DesktopRequests = {
  file_editors: undefined
  file_choose_editor: undefined
  file_open: FileOpenInput
  file_export: FileExportInput
  boot_get_state: undefined
  boot_retry: BootAttemptInput
  boot_acknowledge_frontend: BootFrontendInput
  boot_exit: BootAttemptInput
  startup_get_state: undefined
  startup_choose_directory: undefined
  startup_prepare_migration: MigrationPrepareInput
  startup_start_migration: StartupStartInput
  startup_prepare_fresh: MigrationPrepareInput
  startup_start_fresh: StartupStartInput
  startup_retry_migration: StartupOperationInput
  startup_open_diagnostics: undefined
  startup_continue: StartupOperationInput
  startup_exit: undefined
  desktop_get_state: undefined
  desktop_open_data_directory: undefined
  desktop_open_retained_copy: RetainedCopyInput
  desktop_choose_data_directory: undefined
  storage_prepare_migration: MigrationPrepareInput
  storage_start_migration: MigrationStartInput
  desktop_acknowledge_startup: StartupAcknowledgeInput
  desktop_acknowledge_flush: FlushAcknowledgeInput
  desktop_restart: undefined
  update_check: undefined
  update_download: ReleaseInput
  update_cancel: CancelInput
  update_set_preferences: UpdatePreferences
  update_install: UpdateInstallInput
}
export type DesktopResults = {
  file_editors: InstalledEditors
  file_choose_editor: string | null
  file_open: null
  file_export: string | null
  boot_get_state: BootSnapshot
  boot_retry: BootSnapshot
  boot_acknowledge_frontend: BootSnapshot
  boot_exit: null
  startup_get_state: StartupState
  startup_choose_directory: string | null
  startup_prepare_migration: StartupSnapshot
  startup_start_migration: StartupSnapshot
  startup_prepare_fresh: StartupSnapshot
  startup_start_fresh: StartupSnapshot
  startup_retry_migration: StartupSnapshot
  startup_open_diagnostics: null
  startup_continue: null
  startup_exit: null
  desktop_get_state: DesktopSnapshot
  desktop_open_data_directory: null
  desktop_open_retained_copy: null
  desktop_choose_data_directory: string | null
  storage_prepare_migration: MigrationPlan
  storage_start_migration: MaintenanceState
  desktop_acknowledge_startup: null
  desktop_acknowledge_flush: null
  desktop_restart: null
  update_check: UpdateState
  update_download: UpdateState
  update_cancel: UpdateState
  update_set_preferences: UpdatePreferences
  update_install: MaintenanceState
}
export type DesktopCommand = keyof DesktopRequests
export const desktopCommandMetadata = {
  file_editors: {
    module: "本机文件",
    title: "检测已安装编辑器",
    input: null,
    result: "InstalledEditors",
    effect: "仅本机检测支持的已安装编辑器，不安装程序。",
    source: "src-tauri/src/native_files.rs",
  },
  file_choose_editor: {
    module: "本机文件",
    title: "选择已安装编辑器",
    input: null,
    result: "OptionalString",
    effect: "系统程序文件选择；取消不改变配置。",
    source: "src-tauri/src/native_files.rs",
  },
  file_open: {
    module: "本机文件",
    title: "在外部程序打开当前文件",
    input: "FileOpenInput",
    result: null,
    effect: "本机用户明确操作，重新解析原路径，启动已安装程序或系统关联程序。",
    source: "src-tauri/src/native_files.rs",
  },
  file_export: {
    module: "本机文件",
    title: "另存当前原文件",
    input: "FileExportInput",
    result: "OptionalString",
    effect:
      "系统保存选择，取消返回null；完整复制并复查当前源元数据后发布，失败保留原目标。",
    source: "src-tauri/src/native_files.rs",
  },
  boot_get_state: {
    module: "启动",
    title: "读取真实启动阶段",
    input: null,
    result: "BootSnapshot",
    effect: "仅正常主窗口读取；后台启动期间也可读取当前权威阶段。",
    source: "src-tauri/src/boot.rs",
  },
  boot_retry: {
    module: "启动",
    title: "重试启动",
    input: "BootAttemptInput",
    result: "BootSnapshot",
    effect:
      "仅当前failed尝试；host失败确认旧Node退出后真实启动，前端失败只重做前端恢复和模块加载。",
    source: "src-tauri/src/boot.rs",
  },
  boot_acknowledge_frontend: {
    module: "启动",
    title: "确认前端启动阶段",
    input: "BootFrontendInput",
    result: "BootSnapshot",
    effect:
      "按当前尝试及数据身份依次确认profile和真实工作台模块；都成功后才进入ready。",
    source: "src-tauri/src/boot.rs",
  },
  boot_exit: {
    module: "启动",
    title: "退出启动中的Moon",
    input: "BootAttemptInput",
    result: null,
    effect: "仅当前未ready尝试，实际停止宿主与启动子进程。",
    source: "src-tauri/src/boot.rs",
  },
  startup_get_state: {
    module: "首启迁移",
    title: "读取首启迁移状态",
    input: null,
    result: "StartupState",
    effect: "仅startup窗口读取当前权威状态；正常业务模式返回null。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_choose_directory: {
    module: "首启迁移",
    title: "选择迁移目标",
    input: null,
    result: "OptionalString",
    effect: "系统目录选择；取消不改变状态，换目标令旧计划失效。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_prepare_migration: {
    module: "首启迁移",
    title: "检查首启迁移目标",
    input: "MigrationPrepareInput",
    result: "StartupSnapshot",
    effect:
      "只检查元数据、运行资源与空间，不读取业务正文；五分钟计划绑定当前目标与身份。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_start_migration: {
    module: "首启迁移",
    title: "确认迁移并启动",
    input: "StartupStartInput",
    result: "StartupSnapshot",
    effect: "明确确认后检查、复制和验证；旧副本保留，同计划重复开始幂等。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_prepare_fresh: {
    module: "首次启动",
    title: "检查新数据集目录",
    input: "MigrationPrepareInput",
    result: "StartupSnapshot",
    effect:
      "不读旧业务或旧profile；只为无登记数据的首次启动准备独立空目标计划。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_start_fresh: {
    module: "首次启动",
    title: "不导入旧数据并启动",
    input: "StartupStartInput",
    result: "StartupSnapshot",
    effect:
      "创建独立dataset及profile并权威提交bootstrap；旧数据和失败副本保留，不接管旧非空目标。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_retry_migration: {
    module: "首启迁移",
    title: "重试未提交首次启动操作",
    input: "StartupOperationInput",
    result: "StartupSnapshot",
    effect:
      "仅失败且未提交的同operation按原selection重做导入或空数据初始化，不重放unknown业务请求。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_open_diagnostics: {
    module: "首启迁移",
    title: "打开首启诊断目录",
    input: null,
    result: null,
    effect: "只打开当前固定维护控制目录，不接受任意路径或清理请求。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_continue: {
    module: "首启迁移",
    title: "打开已提交数据的Moon",
    input: "StartupOperationInput",
    result: null,
    effect: "只在bootstrap和目标身份确认已提交后，经受控helper交接正常启动。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  startup_exit: {
    module: "首启迁移",
    title: "退出首启界面",
    input: null,
    result: null,
    effect:
      "确认前、失败或readyToOpen可退出；检查复制校验提交期间不结束worker。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  desktop_get_state: {
    module: "桌面",
    title: "读取桌面状态",
    input: null,
    result: "DesktopSnapshot",
    effect: "只读当前宿主状态。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  desktop_open_data_directory: {
    module: "数据与存储",
    title: "打开数据目录",
    input: null,
    result: null,
    effect: "只打开当前数据目录。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  desktop_open_retained_copy: {
    module: "数据与存储",
    title: "打开保留的旧副本",
    input: "RetainedCopyInput",
    result: null,
    effect: "只打开有效维护记录中指定序号的旧副本，不删除。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  desktop_choose_data_directory: {
    module: "数据与存储",
    title: "选择新数据目录",
    input: null,
    result: "OptionalString",
    effect: "原生选择器；取消返回null。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  storage_prepare_migration: {
    module: "数据与存储",
    title: "预检迁移",
    input: "MigrationPrepareInput",
    result: "MigrationPlan",
    effect: "校验新空目录、空间、权限和身份，不关闭服务。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  storage_start_migration: {
    module: "数据与存储",
    title: "迁移并重启",
    input: "MigrationStartInput",
    result: "MaintenanceState",
    effect: "冻结新写、保存前端恢复状态、排空并离线复制；保留旧副本。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  desktop_acknowledge_startup: {
    module: "桌面维护",
    title: "确认前端恢复",
    input: "StartupAcknowledgeInput",
    result: null,
    effect:
      "只确认当前数据集/代次的profile及可编辑草稿恢复结果；与后端真实数据验证共同确认交接。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  desktop_acknowledge_flush: {
    module: "桌面维护",
    title: "确认前端保存",
    input: "FlushAcknowledgeInput",
    result: null,
    effect: "只接受当前维护身份与nonce的保存结果。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  desktop_restart: {
    module: "桌面维护",
    title: "维护失败后重启恢复",
    input: null,
    result: null,
    effect: "仅不可逆维护失败/unknown允许，同一有效数据根恢复。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  update_check: {
    module: "关于与更新",
    title: "检查更新",
    input: null,
    result: "UpdateState",
    effect: "固定GitHub stable来源；不自动安装。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  update_download: {
    module: "关于与更新",
    title: "下载并验证更新",
    input: "ReleaseInput",
    result: "UpdateState",
    effect: "后台官方download，签名验证后才可安装。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  update_cancel: {
    module: "关于与更新",
    title: "取消检查或下载",
    input: "CancelInput",
    result: "UpdateState",
    effect: "只能取消当前网络阶段。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  update_set_preferences: {
    module: "关于与更新",
    title: "保存更新偏好",
    input: "UpdatePreferences",
    result: "UpdatePreferences",
    effect: "保存到当前数据根，默认自动检查开/自动下载关。",
    source: "src-tauri/src/desktop_commands.rs",
  },
  update_install: {
    module: "关于与更新",
    title: "安装并重启",
    input: "UpdateInstallInput",
    result: "MaintenanceState",
    effect: "明确确认、冻结、保存、严格drain后官方install。",
    source: "src-tauri/src/desktop_commands.rs",
  },
} as const
export const desktopSchemaMetadata = {
  BootStage: {
    type: "string",
    enum: [
      "profile",
      "backend",
      "storage",
      "frontendProfile",
      "workbench",
      "ready",
    ],
  },
  BootPhase: {
    type: "string",
    enum: ["starting", "waitingFrontend", "failed", "ready"],
  },
  BootHostMode: { type: "string", enum: ["desktop"] },
  BootIssue: {
    type: "object",
    properties: {
      code: { $ref: "IssueCode" },
      stage: { $ref: "BootStage" },
      message: { type: "string" },
      diagnostics: { type: "string" },
    },
  },
  BootCapabilities: {
    type: "object",
    properties: { retry: { type: "boolean" }, exit: { type: "boolean" } },
  },
  BootSnapshot: {
    type: "object",
    properties: {
      attemptId: { type: "string" },
      revision: { type: "integer" },
      hostMode: { $ref: "BootHostMode" },
      phase: { $ref: "BootPhase" },
      stage: { $ref: "BootStage" },
      storage: { nullable: { $ref: "StorageInfo" } },
      issue: { nullable: { $ref: "BootIssue" } },
      capabilities: { $ref: "BootCapabilities" },
    },
  },
  BootAttemptInput: {
    type: "object",
    properties: { attemptId: { type: "string" } },
  },
  BootFrontendStage: { type: "string", enum: ["profile", "workbench"] },
  BootFrontendInput: {
    type: "object",
    properties: {
      attemptId: { type: "string" },
      dataSetId: { type: "string" },
      generation: { type: "integer" },
      stage: { $ref: "BootFrontendStage" },
      ready: { type: "boolean" },
    },
  },
  StartupSelection: { type: "string", enum: ["import", "fresh"] },
  StartupPhase: {
    type: "string",
    enum: [
      "awaitingConfirmation",
      "preparing",
      "ready",
      "inspecting",
      "copying",
      "validating",
      "committing",
      "readyToOpen",
      "failed",
    ],
  },
  StartupFailureStage: {
    type: "string",
    enum: [
      "runtime",
      "target",
      "source",
      "inspecting",
      "copying",
      "validating",
      "committing",
      "opening",
    ],
  },
  StartupIssueCode: {
    type: "string",
    enum: [
      "runtimeMissing",
      "dependencyMissing",
      "runtimeIncompatible",
      "sourceBusy",
      "sourceInvalid",
      "targetInvalid",
      "permission",
      "insufficientSpace",
      "dataInvalid",
      "storageIo",
      "planExpired",
      "interrupted",
      "internal",
    ],
  },
  StartupIssue: {
    type: "object",
    properties: {
      code: { $ref: "StartupIssueCode" },
      stage: { $ref: "StartupFailureStage" },
      message: { type: "string" },
      path: { nullable: { type: "string" } },
      retryable: { type: "boolean" },
    },
  },
  StartupCapabilities: {
    type: "object",
    properties: {
      chooseDirectory: { type: "boolean" },
      prepare: { type: "boolean" },
      migrate: { type: "boolean" },
      createFresh: { type: "boolean" },
      retry: { type: "boolean" },
      openDiagnostics: { type: "boolean" },
      exit: { type: "boolean" },
      continueStartup: { type: "boolean" },
    },
  },
  StartupSnapshot: {
    type: "object",
    properties: {
      revision: { type: "integer" },
      operationId: { nullable: { type: "string" } },
      planId: { nullable: { type: "string" } },
      planExpiresAt: { nullable: { type: "string" } },
      phase: { $ref: "StartupPhase" },
      selection: { nullable: { $ref: "StartupSelection" } },
      sourceDirectory: { type: "string" },
      legacyProfileDirectory: { nullable: { type: "string" } },
      targetDirectory: { type: "string" },
      defaultDirectory: { type: "string" },
      retainedCopyDirectories: { type: "array", items: { type: "string" } },
      fileCount: { nullable: { type: "integer" } },
      totalBytes: { nullable: { type: "integer" } },
      availableBytes: { nullable: { type: "integer" } },
      completedFiles: { type: "integer" },
      copiedBytes: { nullable: { type: "integer" } },
      issue: { nullable: { $ref: "StartupIssue" } },
      capabilities: { $ref: "StartupCapabilities" },
    },
  },
  StartupState: { nullable: { $ref: "StartupSnapshot" } },
  StartupStartInput: {
    type: "object",
    properties: {
      planId: { type: "string" },
      targetDirectory: { type: "string" },
    },
  },
  StartupOperationInput: {
    type: "object",
    properties: { operationId: { type: "string" } },
  },
  IssueCode: {
    type: "string",
    enum: [
      "validation",
      "permission",
      "busy",
      "offline",
      "signature",
      "compatibility",
      "unavailable",
      "cancelled",
      "unknown",
      "internal",
    ],
  },
  RecoveryAction: {
    type: "string",
    enum: ["retry", "chooseDirectory", "wait", "restart", "none"],
  },
  ActivityKind: {
    type: "string",
    enum: ["conversation", "request", "authorization", "frontend"],
  },
  Activity: {
    type: "object",
    properties: {
      id: { type: "string" },
      kind: { $ref: "ActivityKind" },
      label: { type: "string" },
      sessionId: { nullable: { type: "string" } },
      stoppable: { type: "boolean" },
    },
  },
  DesktopIssue: {
    type: "object",
    properties: {
      code: { $ref: "IssueCode" },
      message: { type: "string" },
      recovery: { $ref: "RecoveryAction" },
      activities: { type: "array", items: { $ref: "Activity" } },
    },
  },
  StorageSource: {
    type: "string",
    enum: [
      "installation",
      "custom",
      "developmentDefault",
      "developmentEnvironment",
    ],
  },
  StorageDirectoryMapping: {
    type: "object",
    properties: {
      sourceRoot: { type: "string" },
      targetRoot: { type: "string" },
    },
  },
  StorageInfo: {
    type: "object",
    properties: {
      dataDirectory: { type: "string" },
      installDirectory: { type: "string" },
      source: { $ref: "StorageSource" },
      dataSetId: { type: "string" },
      generation: { type: "integer" },
      schemaVersion: { type: "integer" },
      legacyCopyRetained: { type: "boolean" },
      retainedCopyDirectories: { type: "array", items: { type: "string" } },
      directoryMappings: {
        type: "array",
        items: { $ref: "StorageDirectoryMapping" },
      },
      usedBytes: { type: "integer" },
      availableBytes: { nullable: { type: "integer" } },
    },
  },
  DesktopCapabilities: {
    type: "object",
    properties: {
      migrateData: { type: "boolean" },
      openDataDirectory: { type: "boolean" },
      checkUpdates: { type: "boolean" },
      installUpdates: { type: "boolean" },
      unavailableReason: { nullable: { type: "string" } },
    },
  },
  MigrationPlan: {
    type: "object",
    properties: {
      planId: { type: "string" },
      sourceDirectory: { type: "string" },
      targetDirectory: { type: "string" },
      dataSetId: { type: "string" },
      generation: { type: "integer" },
      fileCount: { type: "integer" },
      totalBytes: { type: "integer" },
      expiresAt: { type: "string" },
      activities: { type: "array", items: { $ref: "Activity" } },
    },
  },
  MaintenanceKind: { type: "string", enum: ["none", "migration", "update"] },
  MaintenancePhase: {
    type: "string",
    enum: [
      "idle",
      "preparing",
      "flushing",
      "closing",
      "waitingForExit",
      "copying",
      "validating",
      "committing",
      "handedOff",
      "succeeded",
      "failed",
      "unknown",
    ],
  },
  MaintenanceState: {
    type: "object",
    properties: {
      operationId: { nullable: { type: "string" } },
      revision: { type: "integer" },
      kind: { $ref: "MaintenanceKind" },
      phase: { $ref: "MaintenancePhase" },
      shutdownStarted: { type: "boolean" },
      writesFrozen: { type: "boolean" },
      sourceDirectory: { nullable: { type: "string" } },
      targetDirectory: { nullable: { type: "string" } },
      completedFiles: { type: "integer" },
      totalFiles: { type: "integer" },
      issue: { nullable: { $ref: "DesktopIssue" } },
    },
  },
  UpdatePreferences: {
    type: "object",
    properties: {
      autoCheck: { type: "boolean" },
      autoDownload: { type: "boolean" },
    },
  },
  UpdateRelease: {
    type: "object",
    properties: {
      releaseId: { type: "string" },
      version: { type: "string" },
      notes: { type: "string" },
      publishedAt: { nullable: { type: "string" } },
    },
  },
  UpdatePhase: {
    type: "string",
    enum: [
      "unavailable",
      "idle",
      "checking",
      "current",
      "available",
      "downloading",
      "verifying",
      "ready",
      "preparing",
      "handedOff",
      "succeeded",
      "failed",
      "unknown",
    ],
  },
  UpdateState: {
    type: "object",
    properties: {
      operationId: { nullable: { type: "string" } },
      revision: { type: "integer" },
      phase: { $ref: "UpdatePhase" },
      release: { nullable: { $ref: "UpdateRelease" } },
      downloadedBytes: { type: "integer" },
      totalBytes: { nullable: { type: "integer" } },
      checkedAt: { nullable: { type: "string" } },
      issue: { nullable: { $ref: "DesktopIssue" } },
    },
  },
  DesktopSnapshot: {
    type: "object",
    properties: {
      revision: { type: "integer" },
      version: { type: "string" },
      platform: { type: "string" },
      architecture: { type: "string" },
      development: { type: "boolean" },
      storage: { $ref: "StorageInfo" },
      capabilities: { $ref: "DesktopCapabilities" },
      maintenance: { $ref: "MaintenanceState" },
      update: { $ref: "UpdateState" },
      updatePreferences: { $ref: "UpdatePreferences" },
    },
  },
  FlushReason: { type: "string", enum: ["migration", "update"] },
  FlushRequest: {
    type: "object",
    properties: {
      operationId: { type: "string" },
      nonce: { type: "string" },
      reason: { $ref: "FlushReason" },
      timeoutMilliseconds: { type: "integer" },
    },
  },
  StartupAcknowledgeInput: {
    type: "object",
    properties: {
      dataSetId: { type: "string" },
      generation: { type: "integer" },
      profileReady: { type: "boolean" },
      message: { nullable: { type: "string" } },
    },
  },
  MigrationPrepareInput: {
    type: "object",
    properties: { targetDirectory: { type: "string" } },
  },
  MigrationStartInput: {
    type: "object",
    properties: { planId: { type: "string" }, stopActive: { type: "boolean" } },
  },
  FlushAcknowledgeInput: {
    type: "object",
    properties: {
      operationId: { type: "string" },
      nonce: { type: "string" },
      saved: { type: "boolean" },
      blockers: { type: "array", items: { $ref: "Activity" } },
    },
  },
  ReleaseInput: {
    type: "object",
    properties: { releaseId: { type: "string" } },
  },
  UpdateInstallInput: {
    type: "object",
    properties: {
      releaseId: { type: "string" },
      stopActive: { type: "boolean" },
    },
  },
  CancelInput: {
    type: "object",
    properties: { operationId: { type: "string" } },
  },
  RetainedCopyInput: {
    type: "object",
    properties: { index: { type: "integer" } },
  },
  FileOpenInput: {
    type: "object",
    properties: {
      path: { type: "string" },
      program: { nullable: { type: "string" } },
    },
  },
  FileExportInput: {
    type: "object",
    properties: { path: { type: "string" }, name: { type: "string" } },
  },
  InstalledEditor: {
    type: "object",
    properties: { name: { type: "string" }, path: { type: "string" } },
  },
  InstalledEditors: { type: "array", items: { $ref: "InstalledEditor" } },
} as const
export type DesktopEvents = {
  "moon://boot-state": BootSnapshot
  "moon://startup-state": StartupSnapshot
  "moon://desktop-state": DesktopSnapshot
  "moon://maintenance-flush": FlushRequest
}
