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
  BootStage: enumeration(
    "profile",
    "backend",
    "storage",
    "frontendProfile",
    "workbench",
    "ready"
  ),
  BootPhase: enumeration("starting", "waitingFrontend", "failed", "ready"),
  BootHostMode: enumeration("desktop"),
  BootIssue: object({
    code: ref("IssueCode"),
    stage: ref("BootStage"),
    message: str,
    diagnostics: str,
  }),
  BootCapabilities: object({ retry: bool, exit: bool }),
  BootSnapshot: object({
    attemptId: str,
    revision: num,
    hostMode: ref("BootHostMode"),
    phase: ref("BootPhase"),
    stage: ref("BootStage"),
    storage: nullable(ref("StorageInfo")),
    issue: nullable(ref("BootIssue")),
    capabilities: ref("BootCapabilities"),
  }),
  BootAttemptInput: object({ attemptId: str }),
  BootFrontendStage: enumeration("profile", "workbench"),
  BootFrontendInput: object({
    attemptId: str,
    dataSetId: str,
    generation: num,
    stage: ref("BootFrontendStage"),
    ready: bool,
  }),
  StartupSelection: enumeration("import", "fresh"),
  StartupPhase: enumeration(
    "awaitingConfirmation",
    "preparing",
    "ready",
    "inspecting",
    "copying",
    "validating",
    "committing",
    "readyToOpen",
    "failed"
  ),
  StartupFailureStage: enumeration(
    "runtime",
    "target",
    "source",
    "inspecting",
    "copying",
    "validating",
    "committing",
    "opening"
  ),
  StartupIssueCode: enumeration(
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
    "internal"
  ),
  StartupIssue: object({
    code: ref("StartupIssueCode"),
    stage: ref("StartupFailureStage"),
    message: str,
    path: nullable(str),
    retryable: bool,
  }),
  StartupCapabilities: object({
    chooseDirectory: bool,
    prepare: bool,
    migrate: bool,
    createFresh: bool,
    retry: bool,
    openDiagnostics: bool,
    exit: bool,
    continueStartup: bool,
  }),
  StartupSnapshot: object({
    revision: num,
    operationId: nullable(str),
    planId: nullable(str),
    planExpiresAt: nullable(str),
    phase: ref("StartupPhase"),
    selection: nullable(ref("StartupSelection")),
    sourceDirectory: str,
    legacyProfileDirectory: nullable(str),
    targetDirectory: str,
    defaultDirectory: str,
    retainedCopyDirectories: array(str),
    fileCount: nullable(num),
    totalBytes: nullable(num),
    availableBytes: nullable(num),
    completedFiles: num,
    copiedBytes: nullable(num),
    issue: nullable(ref("StartupIssue")),
    capabilities: ref("StartupCapabilities"),
  }),
  StartupState: nullable(ref("StartupSnapshot")),
  StartupStartInput: object({ planId: str, targetDirectory: str }),
  StartupOperationInput: object({ operationId: str }),
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
  FileOpenInput: object({ path: str, program: nullable(str) }),
  FileExportInput: object({ path: str, name: str }),
  InstalledEditor: object({ name: str, path: str }),
  InstalledEditors: array(ref("InstalledEditor")),
}
const command = (module, title, input, result, effect) => ({
  module,
  title,
  input,
  result,
  effect,
  source:
    module === "启动"
      ? "src-tauri/src/boot.rs"
      : "src-tauri/src/desktop_commands.rs",
})
export const desktopCommands = {
  file_editors: { ...command("本机文件", "检测已安装编辑器", null, "InstalledEditors", "仅本机检测支持的已安装编辑器，不安装程序。"), source: "src-tauri/src/native_files.rs" },
  file_choose_editor: { ...command("本机文件", "选择已安装编辑器", null, "OptionalString", "系统程序文件选择；取消不改变配置。"), source: "src-tauri/src/native_files.rs" },
  file_open: { ...command("本机文件", "在外部程序打开当前文件", "FileOpenInput", null, "本机用户明确操作，重新解析原路径，启动已安装程序或系统关联程序。"), source: "src-tauri/src/native_files.rs" },
  file_export: { ...command("本机文件", "另存当前原文件", "FileExportInput", "OptionalString", "系统保存选择，取消返回null；完整复制并复查当前源元数据后发布，失败保留原目标。"), source: "src-tauri/src/native_files.rs" },
  boot_get_state: command(
    "启动",
    "读取真实启动阶段",
    null,
    "BootSnapshot",
    "仅正常主窗口读取；后台启动期间也可读取当前权威阶段。"
  ),
  boot_retry: command(
    "启动",
    "重试启动",
    "BootAttemptInput",
    "BootSnapshot",
    "仅当前failed尝试；host失败确认旧Node退出后真实启动，前端失败只重做前端恢复和模块加载。"
  ),
  boot_acknowledge_frontend: command(
    "启动",
    "确认前端启动阶段",
    "BootFrontendInput",
    "BootSnapshot",
    "按当前尝试及数据身份依次确认profile和真实工作台模块；都成功后才进入ready。"
  ),
  boot_exit: command(
    "启动",
    "退出启动中的Moon",
    "BootAttemptInput",
    null,
    "仅当前未ready尝试，实际停止宿主与启动子进程。"
  ),
  startup_get_state: command(
    "首启迁移",
    "读取首启迁移状态",
    null,
    "StartupState",
    "仅startup窗口读取当前权威状态；正常业务模式返回null。"
  ),
  startup_choose_directory: command(
    "首启迁移",
    "选择迁移目标",
    null,
    "OptionalString",
    "系统目录选择；取消不改变状态，换目标令旧计划失效。"
  ),
  startup_prepare_migration: command(
    "首启迁移",
    "检查首启迁移目标",
    "MigrationPrepareInput",
    "StartupSnapshot",
    "只检查元数据、运行资源与空间，不读取业务正文；五分钟计划绑定当前目标与身份。"
  ),
  startup_start_migration: command(
    "首启迁移",
    "确认迁移并启动",
    "StartupStartInput",
    "StartupSnapshot",
    "明确确认后检查、复制和验证；旧副本保留，同计划重复开始幂等。"
  ),
  startup_prepare_fresh: command(
    "首次启动",
    "检查新数据集目录",
    "MigrationPrepareInput",
    "StartupSnapshot",
    "不读旧业务或旧profile；只为无登记数据的首次启动准备独立空目标计划。"
  ),
  startup_start_fresh: command(
    "首次启动",
    "不导入旧数据并启动",
    "StartupStartInput",
    "StartupSnapshot",
    "创建独立dataset及profile并权威提交bootstrap；旧数据和失败副本保留，不接管旧非空目标。"
  ),
  startup_retry_migration: command(
    "首启迁移",
    "重试未提交首次启动操作",
    "StartupOperationInput",
    "StartupSnapshot",
    "仅失败且未提交的同operation按原selection重做导入或空数据初始化，不重放unknown业务请求。"
  ),
  startup_open_diagnostics: command(
    "首启迁移",
    "打开首启诊断目录",
    null,
    null,
    "只打开当前固定维护控制目录，不接受任意路径或清理请求。"
  ),
  startup_continue: command(
    "首启迁移",
    "打开已提交数据的Moon",
    "StartupOperationInput",
    null,
    "只在bootstrap和目标身份确认已提交后，经受控helper交接正常启动。"
  ),
  startup_exit: command(
    "首启迁移",
    "退出首启界面",
    null,
    null,
    "确认前、失败或readyToOpen可退出；检查复制校验提交期间不结束worker。"
  ),
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
  "moon://boot-state": "BootSnapshot",
  "moon://startup-state": "StartupSnapshot",
  "moon://desktop-state": "DesktopSnapshot",
  "moon://maintenance-flush": "FlushRequest",
}
