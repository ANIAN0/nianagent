// Generated from backend/desktop-contract.mjs. Do not edit.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum IssueCode {
    #[serde(rename = "validation")]
    Validation,
    #[serde(rename = "permission")]
    Permission,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "offline")]
    Offline,
    #[serde(rename = "signature")]
    Signature,
    #[serde(rename = "compatibility")]
    Compatibility,
    #[serde(rename = "unavailable")]
    Unavailable,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "unknown")]
    Unknown,
    #[serde(rename = "internal")]
    Internal,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum RecoveryAction {
    #[serde(rename = "retry")]
    Retry,
    #[serde(rename = "chooseDirectory")]
    ChooseDirectory,
    #[serde(rename = "wait")]
    Wait,
    #[serde(rename = "restart")]
    Restart,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ActivityKind {
    #[serde(rename = "conversation")]
    Conversation,
    #[serde(rename = "request")]
    Request,
    #[serde(rename = "authorization")]
    Authorization,
    #[serde(rename = "frontend")]
    Frontend,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Activity {
    pub id: String,
    pub kind: ActivityKind,
    pub label: String,
    pub session_id: Option<String>,
    pub stoppable: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopIssue {
    pub code: IssueCode,
    pub message: String,
    pub recovery: RecoveryAction,
    pub activities: Vec<Activity>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum StorageSource {
    #[serde(rename = "installation")]
    Installation,
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "developmentDefault")]
    DevelopmentDefault,
    #[serde(rename = "developmentEnvironment")]
    DevelopmentEnvironment,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageDirectoryMapping {
    pub source_root: String,
    pub target_root: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageInfo {
    pub data_directory: String,
    pub install_directory: String,
    pub source: StorageSource,
    pub data_set_id: String,
    pub generation: u64,
    pub schema_version: u64,
    pub legacy_copy_retained: bool,
    pub retained_copy_directories: Vec<String>,
    pub directory_mappings: Vec<StorageDirectoryMapping>,
    pub used_bytes: u64,
    pub available_bytes: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopCapabilities {
    pub migrate_data: bool,
    pub open_data_directory: bool,
    pub check_updates: bool,
    pub install_updates: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationPlan {
    pub plan_id: String,
    pub source_directory: String,
    pub target_directory: String,
    pub data_set_id: String,
    pub generation: u64,
    pub file_count: u64,
    pub total_bytes: u64,
    pub expires_at: String,
    pub activities: Vec<Activity>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum MaintenanceKind {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "migration")]
    Migration,
    #[serde(rename = "update")]
    Update,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum MaintenancePhase {
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "preparing")]
    Preparing,
    #[serde(rename = "flushing")]
    Flushing,
    #[serde(rename = "closing")]
    Closing,
    #[serde(rename = "waitingForExit")]
    WaitingForExit,
    #[serde(rename = "copying")]
    Copying,
    #[serde(rename = "validating")]
    Validating,
    #[serde(rename = "committing")]
    Committing,
    #[serde(rename = "handedOff")]
    HandedOff,
    #[serde(rename = "succeeded")]
    Succeeded,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaintenanceState {
    pub operation_id: Option<String>,
    pub revision: u64,
    pub kind: MaintenanceKind,
    pub phase: MaintenancePhase,
    pub shutdown_started: bool,
    pub writes_frozen: bool,
    pub source_directory: Option<String>,
    pub target_directory: Option<String>,
    pub completed_files: u64,
    pub total_files: u64,
    pub issue: Option<DesktopIssue>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePreferences {
    pub auto_check: bool,
    pub auto_download: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateRelease {
    pub release_id: String,
    pub version: String,
    pub notes: String,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum UpdatePhase {
    #[serde(rename = "unavailable")]
    Unavailable,
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "checking")]
    Checking,
    #[serde(rename = "current")]
    Current,
    #[serde(rename = "available")]
    Available,
    #[serde(rename = "downloading")]
    Downloading,
    #[serde(rename = "verifying")]
    Verifying,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "preparing")]
    Preparing,
    #[serde(rename = "handedOff")]
    HandedOff,
    #[serde(rename = "succeeded")]
    Succeeded,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateState {
    pub operation_id: Option<String>,
    pub revision: u64,
    pub phase: UpdatePhase,
    pub release: Option<UpdateRelease>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub checked_at: Option<String>,
    pub issue: Option<DesktopIssue>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSnapshot {
    pub revision: u64,
    pub version: String,
    pub platform: String,
    pub architecture: String,
    pub development: bool,
    pub storage: StorageInfo,
    pub capabilities: DesktopCapabilities,
    pub maintenance: MaintenanceState,
    pub update: UpdateState,
    pub update_preferences: UpdatePreferences,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum FlushReason {
    #[serde(rename = "migration")]
    Migration,
    #[serde(rename = "update")]
    Update,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlushRequest {
    pub operation_id: String,
    pub nonce: String,
    pub reason: FlushReason,
    pub timeout_milliseconds: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupAcknowledgeInput {
    pub data_set_id: String,
    pub generation: u64,
    pub profile_ready: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationPrepareInput {
    pub target_directory: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationStartInput {
    pub plan_id: String,
    pub stop_active: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlushAcknowledgeInput {
    pub operation_id: String,
    pub nonce: String,
    pub saved: bool,
    pub blockers: Vec<Activity>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseInput {
    pub release_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateInstallInput {
    pub release_id: String,
    pub stop_active: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelInput {
    pub operation_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetainedCopyInput {
    pub index: u64,
}
