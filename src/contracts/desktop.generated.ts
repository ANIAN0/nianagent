// Generated from backend/desktop-contract.mjs. Do not edit.
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
export type DesktopRequests = {
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
} as const
export type DesktopEvents = {
  "moon://desktop-state": DesktopSnapshot
  "moon://maintenance-flush": FlushRequest
}
