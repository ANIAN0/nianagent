use crate::{
    desktop_contract_generated::*,
    migration,
    models::ModelBackend,
    storage::{self, StoragePaths},
};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
pub type DesktopResult<T> = Result<T, DesktopIssue>;
pub fn issue(
    code: IssueCode,
    message: impl Into<String>,
    recovery: RecoveryAction,
) -> DesktopIssue {
    DesktopIssue {
        code,
        message: message.into(),
        recovery,
        activities: vec![],
    }
}
pub fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}
fn maintenance_record(paths: &StoragePaths) -> Result<Option<Value>, String> {
    let latest = paths.control.join("last-maintenance.json");
    if latest.exists() {
        return storage::read_json(&latest).map(Some);
    }
    // 首次legacy导入可能在bootstrap写穿后、last-maintenance首次落盘前崩溃。
    // 只由当前权威bootstrap/marker证明的同目标记录补回诊断，不重新复制或重放业务。
    let records = std::fs::read_dir(&paths.control).map_err(|_| "维护控制记录不可读取。")?;
    for entry in records.filter_map(Result::ok) {
        if let Ok(record) = storage::read_json(&entry.path()) {
            if committed_migration(paths, &record) {
                return Ok(Some(record));
            }
        }
    }
    Ok(None)
}
fn committed_migration(paths: &StoragePaths, record: &Value) -> bool {
    record["kind"] == "migration"
        && record["dataSetId"] == paths.marker.data_set_id
        && record["targetDirectory"].as_str().is_some_and(|path| {
            dunce::canonicalize(path).is_ok_and(|target| {
                storage::text(&target).eq_ignore_ascii_case(&storage::text(&paths.data))
            })
        })
        && record["generation"].as_u64().is_some_and(|generation| {
            if record["committed"] == true {
                generation == paths.bootstrap.generation
            } else {
                generation.checked_add(1) == Some(paths.bootstrap.generation)
            }
        })
}
pub struct FlushWait {
    pub operation_id: String,
    pub nonce: String,
    pub sender: mpsc::Sender<FlushAcknowledgeInput>,
}
pub struct DesktopRuntime {
    pub paths: Arc<StoragePaths>,
    pub state: Mutex<DesktopSnapshot>,
    pub actions: Mutex<()>,
    pub maintenance_requests: Mutex<()>,
    pub plan: Mutex<Option<MigrationPlan>>,
    pub flush: Mutex<Option<FlushWait>>,
    pub update: Mutex<Option<Update>>,
    pub bytes: Mutex<Option<Vec<u8>>>,
    pub network: Mutex<Option<(String, tauri::async_runtime::JoinHandle<()>)>>,
    pub backend_readable: bool,
}
impl DesktopRuntime {
    pub fn new(paths: StoragePaths, backend_readable: bool) -> Self {
        let supported = cfg!(all(windows, target_arch = "x86_64"));
        let key =
            option_env!("MOON_UPDATER_PUBLIC_KEY").is_some_and(|value| !value.trim().is_empty());
        let reason = if !supported {
            Some("首期自动更新只支持Windows x64。".to_string())
        } else if !key {
            Some("当前构建未配置发行公钥，更新不可用。".to_string())
        } else {
            None
        };
        let preferences = storage::read_json(&paths.data.join("updates/preferences.json"))
            .ok()
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or(UpdatePreferences {
                auto_check: true,
                auto_download: false,
            });
        let mut maintenance = MaintenanceState {
            operation_id: None,
            revision: 0,
            kind: MaintenanceKind::None,
            phase: MaintenancePhase::Idle,
            shutdown_started: false,
            writes_frozen: false,
            source_directory: None,
            target_directory: None,
            completed_files: 0,
            total_files: 0,
            issue: None,
        };
        let mut update = UpdateState {
            operation_id: None,
            revision: 0,
            phase: if reason.is_some() {
                UpdatePhase::Unavailable
            } else {
                UpdatePhase::Idle
            },
            release: None,
            downloaded_bytes: 0,
            total_bytes: None,
            checked_at: storage::read_json(&paths.data.join("updates/check.json"))
                .ok()
                .and_then(|value| value["checkedAt"].as_str().map(str::to_owned)),
            issue: reason
                .clone()
                .map(|message| issue(IssueCode::Unavailable, message, RecoveryAction::None)),
        };
        if let Ok(Some(record)) = maintenance_record(&paths) {
            maintenance.operation_id = record["operationId"].as_str().map(str::to_owned);
            maintenance.kind = if record["kind"] == "migration" {
                MaintenanceKind::Migration
            } else {
                MaintenanceKind::Update
            };
            maintenance.source_directory = record["sourceDirectory"].as_str().map(str::to_owned);
            maintenance.target_directory = record["targetDirectory"].as_str().map(str::to_owned);
            maintenance.shutdown_started = record["shutdownStarted"] == true;
            maintenance.completed_files = record["completedFiles"].as_u64().unwrap_or(0);
            maintenance.total_files = record["totalFiles"].as_u64().unwrap_or(0);
            maintenance.phase = if record["phase"] == "succeeded" {
                MaintenancePhase::Succeeded
            } else {
                MaintenancePhase::Unknown
            };
            if !backend_readable {
                maintenance.phase = MaintenancePhase::Failed;
                maintenance.issue = Some(issue(
                    IssueCode::Compatibility,
                    "程序已启动，但业务数据尚不能恢复，请核对原记录；不会切回旧副本。",
                    RecoveryAction::None,
                ));
            }
            if matches!(maintenance.kind, MaintenanceKind::Update)
                && !matches!(maintenance.phase, MaintenancePhase::Succeeded)
            {
                update.phase = UpdatePhase::Unknown;
            }
        }
        let state = DesktopSnapshot {
            revision: 1,
            version: env!("CARGO_PKG_VERSION").into(),
            platform: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
            development: cfg!(debug_assertions),
            storage: paths.info(),
            capabilities: DesktopCapabilities {
                migrate_data: cfg!(windows)
                    && !matches!(paths.source, StorageSource::DevelopmentEnvironment),
                open_data_directory: true,
                check_updates: supported && key,
                install_updates: supported && key && !cfg!(debug_assertions),
                unavailable_reason: reason,
            },
            maintenance,
            update,
            update_preferences: preferences,
        };
        Self {
            paths: Arc::new(paths),
            actions: Mutex::new(()),
            maintenance_requests: Mutex::new(()),
            state: Mutex::new(state),
            plan: Mutex::new(None),
            flush: Mutex::new(None),
            update: Mutex::new(None),
            bytes: Mutex::new(None),
            network: Mutex::new(None),
            backend_readable,
        }
    }
    pub fn snapshot(&self) -> DesktopSnapshot {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }
    pub fn change(&self, app: &AppHandle, change: impl FnOnce(&mut DesktopSnapshot)) {
        let snapshot = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            change(&mut state);
            state.revision += 1;
            state.maintenance.revision = state.revision;
            state.update.revision = state.revision;
            state.clone()
        };
        let _ = app.emit("moon://desktop-state", snapshot);
    }
    pub fn change_update(
        &self,
        app: &AppHandle,
        operation: &str,
        change: impl FnOnce(&mut DesktopSnapshot),
    ) -> bool {
        let snapshot = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if state.update.operation_id.as_deref() != Some(operation) {
                return false;
            }
            change(&mut state);
            state.revision += 1;
            state.update.revision = state.revision;
            state.maintenance.revision = state.revision;
            state.clone()
        };
        let _ = app.emit("moon://desktop-state", snapshot);
        true
    }
    pub fn persist(&self, record: &Value) -> DesktopResult<()> {
        let id = record["operationId"].as_str().ok_or_else(|| {
            issue(
                IssueCode::Internal,
                "维护身份缺失。",
                RecoveryAction::Restart,
            )
        })?;
        storage::atomic_json(&migration::record_file(&self.paths, id), record)
            .and_then(|_| {
                storage::atomic_json(&self.paths.control.join("last-maintenance.json"), record)
            })
            .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Restart))
    }
    pub fn begin(
        &self,
        app: &AppHandle,
        kind: MaintenanceKind,
        id: String,
        source: Option<String>,
        target: Option<String>,
    ) -> DesktopResult<()> {
        let _action = self.actions.lock().map_err(|_| {
            issue(
                IssueCode::Internal,
                "维护动作锁不可用。",
                RecoveryAction::Restart,
            )
        })?;
        let mut state = self.state.lock().map_err(|_| {
            issue(
                IssueCode::Internal,
                "维护状态不可用。",
                RecoveryAction::Restart,
            )
        })?;
        if state.maintenance.writes_frozen
            || matches!(
                state.update.phase,
                UpdatePhase::Checking | UpdatePhase::Downloading | UpdatePhase::Verifying
            )
        {
            return Err(issue(
                IssueCode::Busy,
                "另一个迁移或更新操作正在进行。",
                RecoveryAction::Wait,
            ));
        }
        state.maintenance = MaintenanceState {
            operation_id: Some(id),
            revision: state.revision,
            kind,
            phase: MaintenancePhase::Preparing,
            shutdown_started: false,
            writes_frozen: true,
            source_directory: source,
            target_directory: target,
            completed_files: 0,
            total_files: 0,
            issue: None,
        };
        drop(state);
        self.change(app, |_| {});
        Ok(())
    }
    pub fn fail(&self, app: &AppHandle, error: DesktopIssue) {
        self.change(app, |state| {
            state.maintenance.phase = MaintenancePhase::Failed;
            state.maintenance.writes_frozen = state.maintenance.shutdown_started;
            state.maintenance.issue = Some(error.clone());
            if matches!(state.maintenance.kind, MaintenanceKind::Update) {
                state.update.phase = UpdatePhase::Failed;
                state.update.issue = Some(error);
            }
        });
    }
    pub fn prepare_shutdown(
        &self,
        app: &AppHandle,
        record: &mut Value,
        stop_active: bool,
    ) -> DesktopResult<()> {
        let result = self.prepare_shutdown_inner(app, record, stop_active);
        self.flush
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take();
        if result.is_err() && !self.snapshot().maintenance.shutdown_started {
            let id = record["operationId"].as_str().unwrap_or_default();
            let resumed = app.state::<ModelBackend>().internal(
                "$maintenance",
                json!({"action":"resume","operationId":id,"stopActive":false}),
                Duration::from_secs(5),
            );
            if !resumed.is_ok_and(|value| {
                value["frozen"] == false && value["closed"] == false && value["operationId"] == id
            }) {
                record["shutdownStarted"] = json!(true);
                let _ = self.persist(record);
                self.change(app, |state| {
                    state.maintenance.shutdown_started = true;
                    state.maintenance.writes_frozen = true;
                });
                return Err(issue(
                    IssueCode::Unknown,
                    "维护预检失败且服务门禁恢复未确认，请重新启动Moon恢复。",
                    RecoveryAction::Restart,
                ));
            }
        }
        result
    }
    fn prepare_shutdown_inner(
        &self,
        app: &AppHandle,
        record: &mut Value,
        stop_active: bool,
    ) -> DesktopResult<()> {
        let id = record["operationId"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let backend = app.state::<ModelBackend>();
        let frozen = backend
            .internal(
                "$maintenance",
                json!({"action":"freeze","operationId":id,"stopActive":stop_active}),
                Duration::from_secs(30),
            )
            .map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Restart))?;
        let activities: Vec<Activity> = serde_json::from_value(frozen["activities"].clone())
            .map_err(|_| {
                issue(
                    IssueCode::Unknown,
                    "后端活动报告无效，不能认定空闲。",
                    RecoveryAction::Restart,
                )
            })?;
        if frozen["operationId"] != id || frozen["frozen"] != true || frozen["closed"] != false {
            return Err(issue(
                IssueCode::Unknown,
                "维护冻结身份未确认。",
                RecoveryAction::Restart,
            ));
        }
        if activities
            .iter()
            .any(|activity| !activity.stoppable || !stop_active)
        {
            return Err(DesktopIssue {
                code: IssueCode::Busy,
                message: "请等待正在保存的操作，或明确停止运行会话后继续。".into(),
                recovery: RecoveryAction::Wait,
                activities,
            });
        }
        let nonce = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel();
        *self
            .flush
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(FlushWait {
            operation_id: id.clone(),
            nonce: nonce.clone(),
            sender,
        });
        self.change(app, |state| {
            state.maintenance.phase = MaintenancePhase::Flushing
        });
        record["phase"] = json!("flushing");
        self.persist(record)?;
        app.emit(
            "moon://maintenance-flush",
            FlushRequest {
                operation_id: id.clone(),
                nonce,
                reason: if record["kind"] == "migration" {
                    FlushReason::Migration
                } else {
                    FlushReason::Update
                },
                timeout_milliseconds: 30_000,
            },
        )
        .map_err(|_| {
            issue(
                IssueCode::Unknown,
                "无法请求前端保存恢复状态。",
                RecoveryAction::Retry,
            )
        })?;
        let ack = receiver.recv_timeout(Duration::from_secs(30));
        self.flush
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take();
        match ack {
            Ok(ack) if ack.saved && ack.blockers.is_empty() => {}
            result => {
                return Err(DesktopIssue {
                    code: IssueCode::Busy,
                    message: "前端草稿或设置尚未确认保存，已停止本次维护。".into(),
                    recovery: RecoveryAction::Retry,
                    activities: result.ok().map(|ack| ack.blockers).unwrap_or_default(),
                });
            }
        }
        // 不可逆界线：任何关闭请求之前必须把shutdownStarted写穿到维护记录。
        record["shutdownStarted"] = json!(true);
        record["phase"] = json!("closing");
        self.persist(record)?;
        self.change(app, |state| {
            state.maintenance.shutdown_started = true;
            state.maintenance.phase = MaintenancePhase::Closing;
        });
        let drained = backend
            .internal(
                "$maintenance",
                json!({"action":"prepareShutdown","operationId":id,"stopActive":stop_active}),
                Duration::from_secs(90),
            )
            .map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Restart))?;
        if drained["closed"] != true {
            return Err(issue(
                IssueCode::Unknown,
                "后端未确认资源关闭，请重启恢复。",
                RecoveryAction::Restart,
            ));
        }
        backend
            .finish_maintenance_shutdown()
            .map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Restart))?;
        Ok(())
    }
    pub fn acknowledge_startup(
        &self,
        app: &AppHandle,
        input: StartupAcknowledgeInput,
    ) -> DesktopResult<()> {
        if input.data_set_id != self.paths.marker.data_set_id
            || input.generation != self.paths.bootstrap.generation
        {
            return Err(issue(
                IssueCode::Validation,
                "启动确认的数据集身份已变化。",
                RecoveryAction::None,
            ));
        }
        let mut startup = storage::read_json(&self.paths.data.join("maintenance/startup.json"))
            .map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Restart))?;
        startup["frontendReady"] = json!(input.profile_ready);
        startup["confirmedAt"] = json!(now());
        storage::atomic_json(&self.paths.data.join("maintenance/startup.json"), &startup)
            .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Restart))?;
        if !self.backend_readable {
            return Err(issue(
                IssueCode::Compatibility,
                "业务数据未能解析恢复，保留当前根与原记录，请先检查存储内容。",
                RecoveryAction::None,
            ));
        }
        let Some(mut record) = maintenance_record(&self.paths)
            .map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Restart))?
        else {
            return Ok(());
        };
        if committed_migration(&self.paths, &record) {
            record["committed"] = json!(true);
            record["generation"] = json!(self.paths.bootstrap.generation);
        }
        if record["phase"] == "succeeded" {
            return Ok(());
        }
        let version_matches = record["kind"] == "migration"
            || record["targetVersion"].as_str() == Some(env!("CARGO_PKG_VERSION"));
        if input.profile_ready
            && self.backend_readable
            && version_matches
            && record["dataSetId"] == self.paths.marker.data_set_id
            && record["generation"] == self.paths.bootstrap.generation
            && (record["kind"] != "migration" || record["committed"] == true)
        {
            record["phase"] = json!("succeeded");
            record["confirmedAt"] = json!(now());
            self.persist(&record)?;
            self.change(app, |state| {
                state.maintenance.phase = MaintenancePhase::Succeeded;
                state.maintenance.writes_frozen = false;
                state.maintenance.issue = None;
                if matches!(state.maintenance.kind, MaintenanceKind::Update) {
                    state.update.phase = UpdatePhase::Succeeded;
                    state.update.issue = None;
                }
            });
        } else {
            let message = if !input.profile_ready {
                input
                    .message
                    .unwrap_or("桌面恢复状态未能读取，原数据保留。".into())
            } else if !version_matches {
                "安装尚未完成或已取消，仍是原程序版本；不会自动重试安装。".into()
            } else {
                "维护后的数据恢复未确认，保留同一权威根与诊断。".into()
            };
            record["phase"] = json!("unknown");
            record["message"] = json!(message);
            self.persist(&record)?;
            self.change(app, |state| {
                state.maintenance.phase = MaintenancePhase::Unknown;
                state.maintenance.writes_frozen = false;
                state.maintenance.issue =
                    Some(issue(IssueCode::Unknown, message, RecoveryAction::None));
            });
        }
        Ok(())
    }
}
fn network_issue(error: tauri_plugin_updater::Error) -> DesktopIssue {
    use tauri_plugin_updater::Error::*;
    match error {
        Minisign(_)
        | Base64(_)
        | SignatureUtf8(_)
        | SignedVersionMismatch { .. }
        | MissingSignedVersion => issue(
            IssueCode::Signature,
            "更新包签名或签名版本无效，不能安装。",
            RecoveryAction::Retry,
        ),
        TargetNotFound(_) | TargetsNotFound(_) | UnsupportedArch | UnsupportedOs
        | Serialization(_) | Semver(_) => issue(
            IssueCode::Compatibility,
            "发行清单不兼容当前Windows x64 NSIS程序。",
            RecoveryAction::Retry,
        ),
        _ => issue(
            IssueCode::Offline,
            "无法连接GitHub或获取完整发行资源，请稍后重试。",
            RecoveryAction::Retry,
        ),
    }
}
pub fn check_update(app: &AppHandle) -> DesktopResult<UpdateState> {
    let service = app.state::<DesktopRuntime>();
    let _action = service
        .actions
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let snapshot = service.snapshot();
    if !snapshot.capabilities.check_updates {
        return Err(issue(
            IssueCode::Unavailable,
            snapshot
                .capabilities
                .unavailable_reason
                .unwrap_or("更新不可用。".into()),
            RecoveryAction::None,
        ));
    }
    if snapshot.maintenance.writes_frozen
        || matches!(
            snapshot.update.phase,
            UpdatePhase::Checking
                | UpdatePhase::Downloading
                | UpdatePhase::Verifying
                | UpdatePhase::Ready
        )
    {
        return Err(issue(
            IssueCode::Busy,
            "当前已有更新任务，请完成或取消后再检查。",
            RecoveryAction::Wait,
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let checked_at = now();
    storage::atomic_json(
        &service.paths.data.join("updates/check.json"),
        &json!({"checkedAt":checked_at}),
    )
    .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Retry))?;
    service.change(app, |state| {
        state.update.operation_id = Some(id.clone());
        state.update.phase = UpdatePhase::Checking;
        state.update.checked_at = Some(checked_at);
        state.update.issue = None;
        state.update.release = None;
        state.update.downloaded_bytes = 0;
        state.update.total_bytes = None;
    });
    let handle = app.clone();
    let operation = id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let service = handle.state::<DesktopRuntime>();
        let before_exit = handle.clone();
        let result = match handle
            .updater_builder()
            .timeout(Duration::from_secs(45))
            .on_before_exit(move || {
                if let Some(backend) = before_exit.try_state::<ModelBackend>() {
                    backend.shutdown();
                }
            })
            .build()
        {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        if service.snapshot().update.operation_id.as_deref() != Some(&operation) {
            return;
        }
        match result {
            Ok(Some(update)) => {
                let prefix = format!("/ANIAN0/nianagent/releases/download/v{}/", update.version);
                if update.download_url.scheme() != "https"
                    || update.download_url.host_str() != Some("github.com")
                    || !update.download_url.path().starts_with(&prefix)
                {
                    service.change_update(&handle, &operation, |state| {
                        state.update.phase = UpdatePhase::Failed;
                        state.update.issue = Some(issue(
                            IssueCode::Compatibility,
                            "发行资产必须固定到同一版本的Moon GitHub Release。",
                            RecoveryAction::Retry,
                        ));
                    });
                    return;
                }
                let release = UpdateRelease {
                    release_id: uuid::Uuid::new_v4().to_string(),
                    version: update.version.clone(),
                    notes: update.body.clone().unwrap_or_default(),
                    published_at: update.date.and_then(|date| date.format(&Rfc3339).ok()),
                };
                if !service.change_update(&handle, &operation, |state| {
                    *service
                        .update
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner()) = Some(update);
                    state.update.phase = UpdatePhase::Available;
                    state.update.release = Some(release.clone());
                }) {
                    return;
                }
                if service.snapshot().update_preferences.auto_download {
                    let _ = download_update(&handle, &release.release_id);
                }
            }
            Ok(None) => {
                service.change_update(&handle, &operation, |state| {
                    state.update.phase = UpdatePhase::Current
                });
            }
            Err(error) => {
                service.change_update(&handle, &operation, |state| {
                    state.update.phase = UpdatePhase::Failed;
                    state.update.issue = Some(network_issue(error));
                });
            }
        }
    });
    *service
        .network
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some((id, task));
    Ok(service.snapshot().update)
}
pub fn download_update(app: &AppHandle, release_id: &str) -> DesktopResult<UpdateState> {
    let service = app.state::<DesktopRuntime>();
    let _action = service
        .actions
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let snapshot = service.snapshot();
    if snapshot
        .update
        .release
        .as_ref()
        .map(|release| release.release_id.as_str())
        != Some(release_id)
    {
        return Err(issue(
            IssueCode::Validation,
            "检查到的版本身份已失效，请重新检查。",
            RecoveryAction::Retry,
        ));
    }
    if matches!(
        snapshot.update.phase,
        UpdatePhase::Downloading | UpdatePhase::Verifying | UpdatePhase::Ready
    ) {
        return Ok(snapshot.update);
    }
    if snapshot.maintenance.writes_frozen {
        return Err(issue(
            IssueCode::Busy,
            "正在维护，请稍后下载。",
            RecoveryAction::Wait,
        ));
    }
    let update = service
        .update
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
        .ok_or_else(|| {
            issue(
                IssueCode::Validation,
                "发行信息已失效，请重新检查。",
                RecoveryAction::Retry,
            )
        })?;
    let id = uuid::Uuid::new_v4().to_string();
    let operation = id.clone();
    service.change(app, |state| {
        state.update.operation_id = Some(id.clone());
        state.update.phase = UpdatePhase::Downloading;
        state.update.downloaded_bytes = 0;
        state.update.total_bytes = None;
        state.update.issue = None;
    });
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let chunks = handle.clone();
        let finished = handle.clone();
        let chunks_id = operation.clone();
        let finished_id = operation.clone();
        let result = update
            .download(
                move |bytes, total| {
                    let service = chunks.state::<DesktopRuntime>();
                    service.change_update(&chunks, &chunks_id, |state| {
                        state.update.downloaded_bytes += bytes as u64;
                        state.update.total_bytes = total;
                    });
                },
                move || {
                    let service = finished.state::<DesktopRuntime>();
                    service.change_update(&finished, &finished_id, |state| {
                        state.update.phase = UpdatePhase::Verifying
                    });
                },
            )
            .await;
        let service = handle.state::<DesktopRuntime>();
        if service.snapshot().update.operation_id.as_deref() != Some(&operation) {
            return;
        }
        match result {
            Ok(bytes) => {
                service.change_update(&handle, &operation, |state| {
                    *service
                        .bytes
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner()) = Some(bytes);
                    state.update.phase = UpdatePhase::Ready;
                });
            }
            Err(error) => {
                service.change_update(&handle, &operation, |state| {
                    state.update.phase = UpdatePhase::Failed;
                    state.update.issue = Some(network_issue(error));
                });
            }
        }
    });
    *service
        .network
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some((id, task));
    Ok(service.snapshot().update)
}
pub fn automatic_check(app: &AppHandle) {
    let service = app.state::<DesktopRuntime>();
    let snapshot = service.snapshot();
    let due = snapshot
        .update
        .checked_at
        .as_deref()
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
        .is_none_or(|date| OffsetDateTime::now_utc() - date >= time::Duration::hours(24));
    if snapshot.update_preferences.auto_check
        && snapshot.capabilities.check_updates
        && due
        && !snapshot.maintenance.writes_frozen
    {
        let _ = check_update(app);
    }
}
