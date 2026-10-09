// 桌面命令、Rust/TypeScript DTO 和接口目录的唯一来源。
const str = { type: "string" }
const num = { type: "integer" }
const bool = { type: "boolean" }
const ref = ($ref) => ({ $ref })
const nullable = (schema) => ({ nullable: schema })
const array = (items) => ({ type: "array", items })
const enumeration = (...values) => ({ type: "string", enum: values })
const object = (properties) => ({ type: "object", properties })
export const desktopSchemas = {
  IssueCode: enumeration(
    "validation",
    "permission",
    "busy",
    "offline",
    "signature",
    "compatibility",
    "unavailable",
    "cancelled",
    "unknown",
    "internal"
  ),
  RecoveryAction: enumeration(
    "retry",
    "chooseDirectory",
    "wait",
    "restart",
    "none"
  ),
  ActivityKind: enumeration(
    "conversation",
    "request",
    "authorization",
    "frontend"
  ),
  Activity: object({
    id: str,
    kind: ref("ActivityKind"),
    label: str,
    sessionId: nullable(str),
    stoppable: bool,
  }),
  DesktopIssue: object({
    code: ref("IssueCode"),
    message: str,
    recovery: ref("RecoveryAction"),
    activities: array(ref("Activity")),
  }),
  StorageSource: enumeration(
    "installation",
    "custom",
    "developmentDefault",
    "developmentEnvironment"
  ),
  StorageDirectoryMapping: object({ sourceRoot: str, targetRoot: str }),
  StorageInfo: object({
    dataDirectory: str,
    installDirectory: str,
    source: ref("StorageSource"),
    dataSetId: str,
    generation: num,
    schemaVersion: num,
    legacyCopyRetained: bool,
    retainedCopyDirectories: array(str),
    directoryMappings: array(ref("StorageDirectoryMapping")),
    usedBytes: num,
    availableBytes: nullable(num),
  }),
  DesktopCapabilities: object({
    migrateData: bool,
    openDataDirectory: bool,
    checkUpdates: bool,
    installUpdates: bool,
    unavailableReason: nullable(str),
  }),
  MigrationPlan: object({
    planId: str,
    sourceDirectory: str,
    targetDirectory: str,
    dataSetId: str,
    generation: num,
    fileCount: num,
    totalBytes: num,
    expiresAt: str,
    activities: array(ref("Activity")),
  }),
  MaintenanceKind: enumeration("none", "migration", "update"),
  MaintenancePhase: enumeration(
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
    "unknown"
  ),
  MaintenanceState: object({
    operationId: nullable(str),
    revision: num,
    kind: ref("MaintenanceKind"),
    phase: ref("MaintenancePhase"),
    shutdownStarted: bool,
    writesFrozen: bool,
    sourceDirectory: nullable(str),
    targetDirectory: nullable(str),
    completedFiles: num,
    totalFiles: num,
    issue: nullable(ref("DesktopIssue")),
  }),
  UpdatePreferences: object({ autoCheck: bool, autoDownload: bool }),
  UpdateRelease: object({
    releaseId: str,
    version: str,
    notes: str,
    publishedAt: nullable(str),
  }),
  UpdatePhase: enumeration(
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
    "unknown"
  ),
  UpdateState: object({
    operationId: nullable(str),
    revision: num,
    phase: ref("UpdatePhase"),
    release: nullable(ref("UpdateRelease")),
    downloadedBytes: num,
    totalBytes: nullable(num),
    checkedAt: nullable(str),
    issue: nullable(ref("DesktopIssue")),
  }),
  DesktopSnapshot: object({
    revision: num,
    version: str,
    platform: str,
    architecture: str,
    development: bool,
    storage: ref("StorageInfo"),
    capabilities: ref("DesktopCapabilities"),
    maintenance: ref("MaintenanceState"),
    update: ref("UpdateState"),
    updatePreferences: ref("UpdatePreferences"),
  }),
  FlushReason: enumeration("migration", "update"),
  FlushRequest: object({
    operationId: str,
    nonce: str,
    reason: ref("FlushReason"),
    timeoutMilliseconds: num,
  }),
  StartupAcknowledgeInput: object({
    dataSetId: str,
    generation: num,
    profileReady: bool,
    message: nullable(str),
  }),
  MigrationPrepareInput: object({ targetDirectory: str }),
  MigrationStartInput: object({ planId: str, stopActive: bool }),
  FlushAcknowledgeInput: object({
    operationId: str,
    nonce: str,
    saved: bool,
    blockers: array(ref("Activity")),
  }),
  ReleaseInput: object({ releaseId: str }),
  UpdateInstallInput: object({ releaseId: str, stopActive: bool }),
  CancelInput: object({ operationId: str }),
  RetainedCopyInput: object({ index: num }),
}
const command = (module, title, input, result, effect) => ({
  module,
  title,
  input,
  result,
  effect,
  source: "src-tauri/src/desktop_commands.rs",
})
export const desktopCommands = {
  desktop_get_state: command(
    "桌面",
    "读取桌面状态",
    null,
    "DesktopSnapshot",
    "只读当前宿主状态。"
  ),
  desktop_open_data_directory: command(
    "数据与存储",
    "打开数据目录",
    null,
    null,
    "只打开当前数据目录。"
  ),
  desktop_open_retained_copy: command(
    "数据与存储",
    "打开保留的旧副本",
    "RetainedCopyInput",
    null,
    "只打开有效维护记录中指定序号的旧副本，不删除。"
  ),
  desktop_choose_data_directory: command(
    "数据与存储",
    "选择新数据目录",
    null,
    "OptionalString",
    "原生选择器；取消返回null。"
  ),
  storage_prepare_migration: command(
    "数据与存储",
    "预检迁移",
    "MigrationPrepareInput",
    "MigrationPlan",
    "校验新空目录、空间、权限和身份，不关闭服务。"
  ),
  storage_start_migration: command(
    "数据与存储",
    "迁移并重启",
    "MigrationStartInput",
    "MaintenanceState",
    "冻结新写、保存前端恢复状态、排空并离线复制；保留旧副本。"
  ),
  desktop_acknowledge_startup: command(
    "桌面维护",
    "确认前端恢复",
    "StartupAcknowledgeInput",
    null,
    "只确认当前数据集/代次的profile及可编辑草稿恢复结果；与后端真实数据验证共同确认交接。"
  ),
  desktop_acknowledge_flush: command(
    "桌面维护",
    "确认前端保存",
    "FlushAcknowledgeInput",
    null,
    "只接受当前维护身份与nonce的保存结果。"
  ),
  desktop_restart: command(
    "桌面维护",
    "维护失败后重启恢复",
    null,
    null,
    "仅不可逆维护失败/unknown允许，同一有效数据根恢复。"
  ),
  update_check: command(
    "关于与更新",
    "检查更新",
    null,
    "UpdateState",
    "固定GitHub stable来源；不自动安装。"
  ),
  update_download: command(
    "关于与更新",
    "下载并验证更新",
    "ReleaseInput",
    "UpdateState",
    "后台官方download，签名验证后才可安装。"
  ),
  update_cancel: command(
    "关于与更新",
    "取消检查或下载",
    "CancelInput",
    "UpdateState",
    "只能取消当前网络阶段。"
  ),
  update_set_preferences: command(
    "关于与更新",
    "保存更新偏好",
    "UpdatePreferences",
    "UpdatePreferences",
    "保存到当前数据根，默认自动检查开/自动下载关。"
  ),
  update_install: command(
    "关于与更新",
    "安装并重启",
    "UpdateInstallInput",
    "MaintenanceState",
    "明确确认、冻结、保存、严格drain后官方install。"
  ),
}
export const desktopEvents = {
  "moon://desktop-state": "DesktopSnapshot",
  "moon://maintenance-flush": "FlushRequest",
}
