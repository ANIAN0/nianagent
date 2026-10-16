//! 首启页只拥有控制profile和迁移状态；业务Node/profile必须等权威根提交后的正常启动。
use crate::{
    desktop_contract_generated::*,
    desktop_runtime::{DesktopResult, issue},
    migration,
    storage::{self, Bootstrap, DataMarker},
    windows_guard,
};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

struct Plan {
    id: String,
    target: String,
    operation: String,
    selection: StartupSelection,
    deadline: Instant,
}
struct Inner {
    snapshot: StartupSnapshot,
    plan: Option<Plan>,
    record: Value,
    handoff_started: bool,
}
pub struct StartupGate {
    pub install: PathBuf,
    pub control: PathBuf,
    pub bootstrap_file: PathBuf,
    pub profile: PathBuf,
    source: PathBuf,
    legacy_profile: PathBuf,
    legacy_temp: PathBuf,
    _installation_lock: File,
    profile_verified: AtomicBool,
    actions: Mutex<()>,
    inner: Mutex<Inner>,
}
fn same(a: &Path, b: &Path) -> bool {
    storage::text(a)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .eq_ignore_ascii_case(storage::text(b).replace('/', "\\").trim_end_matches('\\'))
}
fn busy() -> DesktopIssue {
    issue(
        IssueCode::Busy,
        "首启迁移正在处理，请读取当前状态后操作。",
        RecoveryAction::Wait,
    )
}
fn capabilities(
    phase: &StartupPhase,
    selection: &Option<StartupSelection>,
    retryable: bool,
    has_operation: bool,
) -> StartupCapabilities {
    let editable = matches!(
        phase,
        StartupPhase::AwaitingConfirmation | StartupPhase::Ready | StartupPhase::Failed
    );
    StartupCapabilities {
        choose_directory: editable,
        prepare: editable,
        migrate: matches!(phase, StartupPhase::Ready)
            && matches!(selection, Some(StartupSelection::Import)),
        create_fresh: matches!(phase, StartupPhase::Ready)
            && matches!(selection, Some(StartupSelection::Fresh)),
        retry: matches!(phase, StartupPhase::Failed) && retryable && has_operation,
        open_diagnostics: true,
        exit: editable || matches!(phase, StartupPhase::ReadyToOpen),
        continue_startup: matches!(phase, StartupPhase::ReadyToOpen),
    }
}
impl StartupGate {
    pub fn inspect() -> Result<Option<Arc<Self>>, String> {
        // 开发默认根不导入用户旧目录；真实production分支可用隔离 tauri dev --release 验收。
        if cfg!(debug_assertions) {
            return Ok(None);
        }
        let install = dunce::canonicalize(
            std::env::current_exe()
                .map_err(|_| "无法定位Moon程序。")?
                .parent()
                .ok_or("程序目录无效。")?,
        )
        .map_err(|_| "程序目录不存在。")?;
        storage::private_directory(&install, true)?;
        let control = install.join(".moon-control");
        storage::private_directory(&control, true)?;
        let installation_lock = storage::exclusive(&control.join("installation.lock"))?;
        let bootstrap_file = install.join("moon.bootstrap.json");
        if bootstrap_file.exists() {
            return Ok(None);
        }
        // 引导意外缺失不等于首次安装；可信已提交控制记录禁止创建新身份覆盖原数据。
        if has_committed_record(&install, &control)? {
            return Err(
                "Moon已有提交的数据记录，但引导文件缺失。请恢复原引导；不会初始化另一套空数据。"
                    .into(),
            );
        }
        let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
            return Ok(None);
        };
        let source = local.join("Moon/models");
        let legacy_profile = local.join("local.moon.desktop");
        if !source.exists() && !legacy_profile.join("EBWebView").exists() {
            return Ok(None);
        }
        let default = install.join("data");
        let mut candidates = fs::read_dir(&control)
            .map_err(|_| "无法读取首启维护记录。")?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let record = storage::read_json(&entry.path()).ok()?;
                let id = record["operationId"].as_str()?;
                if entry.file_name().to_string_lossy() != format!("{id}.json") {
                    return None;
                }
                Some((entry.metadata().ok()?.modified().ok()?, record))
            })
            .filter(|(_, record)| {
                (record["kind"] == "migration" || record["kind"] == "initialize")
                    && record["committed"] == false
                    && record["generation"] == 0
                    && [
                        ("installDirectory", &install),
                        ("controlDirectory", &control),
                        ("bootstrapFile", &bootstrap_file),
                        ("sourceDirectory", &source),
                        ("legacyProfileDirectory", &legacy_profile),
                    ]
                    .iter()
                    .all(|(key, path)| {
                        record[*key]
                            .as_str()
                            .is_some_and(|value| same(Path::new(value), path))
                    })
                    && ["operationId", "dataSetId"].iter().all(|key| {
                        record[*key]
                            .as_str()
                            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
                    })
                    && record["targetDirectory"]
                        .as_str()
                        .is_some_and(|path| Path::new(path).is_absolute())
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|a, b| b.0.cmp(&a.0));
        let latest = storage::read_json(&control.join("last-maintenance.json")).ok();
        let previous = latest
            .and_then(|latest| {
                candidates
                    .iter()
                    .find(|(_, record)| {
                        record["operationId"] == latest["operationId"]
                            && record["dataSetId"] == latest["dataSetId"]
                    })
                    .map(|(_, record)| record.clone())
            })
            .or_else(|| candidates.first().map(|(_, record)| record.clone()));
        // 捕获覆盖TMP之前的旧Temp，历史输出引用不能被启动页自己的临时根替代。
        let legacy_temp = previous
            .as_ref()
            .and_then(|record| record["legacyTempDirectory"].as_str())
            .filter(|path| Path::new(path).is_absolute())
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let target = previous
            .as_ref()
            .and_then(|record| record["targetDirectory"].as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| storage::text(&default));
        let operation_id = previous
            .as_ref()
            .and_then(|record| record["operationId"].as_str())
            .map(str::to_owned);
        let phase = if previous.is_some() {
            StartupPhase::Failed
        } else {
            StartupPhase::AwaitingConfirmation
        };
        let previous_issue = previous.as_ref().map(|record| {
            serde_json::from_value::<StartupIssue>(record["startupIssue"].clone())
                .ok()
                .unwrap_or_else(|| {
                    migration::failure(
                        StartupIssueCode::Interrupted,
                        StartupFailureStage::Inspecting,
                        "上次迁移未完成，原数据与维护记录保留。请检查当前目标后重试。",
                        Some(&control),
                    )
                })
        });
        let retained = previous
            .as_ref()
            .map(validated_retained)
            .unwrap_or_default();
        let profile = control.join("startup-profile");
        let sandbox = control.join("startup");
        for path in [&profile, &sandbox] {
            storage::private_directory(path, true)?;
        }
        for directory in ["tmp", "logs", "agent"] {
            fs::create_dir_all(sandbox.join(directory)).map_err(|_| "无法创建私有启动目录。")?;
        }
        unsafe {
            std::env::set_var("TMP", sandbox.join("tmp"));
            std::env::set_var("TEMP", sandbox.join("tmp"));
        }
        let snapshot = StartupSnapshot {
            revision: 1,
            operation_id,
            plan_id: None,
            plan_expires_at: None,
            phase: phase.clone(),
            selection: previous.as_ref().map(|record| {
                if record["kind"] == "initialize" {
                    StartupSelection::Fresh
                } else {
                    StartupSelection::Import
                }
            }),
            source_directory: storage::text(&source),
            legacy_profile_directory: legacy_profile
                .exists()
                .then(|| storage::text(&legacy_profile)),
            target_directory: target,
            default_directory: storage::text(&default),
            retained_copy_directories: retained,
            file_count: None,
            total_bytes: None,
            available_bytes: None,
            completed_files: 0,
            copied_bytes: None,
            issue: previous_issue,
            capabilities: StartupCapabilities {
                choose_directory: false,
                prepare: false,
                migrate: false,
                create_fresh: false,
                retry: false,
                open_diagnostics: true,
                exit: true,
                continue_startup: false,
            },
        };
        Ok(Some(Arc::new(Self {
            install,
            control,
            bootstrap_file,
            profile,
            source,
            legacy_profile,
            legacy_temp,
            _installation_lock: installation_lock,
            profile_verified: AtomicBool::new(false),
            actions: Mutex::new(()),
            inner: Mutex::new(Inner {
                snapshot,
                plan: None,
                record: previous.unwrap_or(Value::Null),
                handoff_started: false,
            }),
        })))
    }
    pub fn snapshot(&self) -> StartupSnapshot {
        self.inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .snapshot
            .clone()
    }
    pub fn profile_verified(&self) -> bool {
        self.profile_verified.load(Ordering::SeqCst)
    }
    pub fn controlled_handoff_exit(&self) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .handoff_started
    }
    pub fn activate(&self, app: &AppHandle) {
        self.profile_verified.store(true, Ordering::SeqCst);
        self.change(app, |_| {});
    }
    fn change(&self, app: &AppHandle, update: impl FnOnce(&mut Inner)) -> StartupSnapshot {
        let snapshot = {
            let mut state = self
                .inner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            update(&mut state);
            state.snapshot.revision += 1;
            state.snapshot.capabilities = capabilities(
                &state.snapshot.phase,
                &state.snapshot.selection,
                state
                    .snapshot
                    .issue
                    .as_ref()
                    .is_none_or(|issue| issue.retryable),
                state.snapshot.operation_id.is_some(),
            );
            if !self.profile_verified() {
                state.snapshot.capabilities.choose_directory = false;
                state.snapshot.capabilities.prepare = false;
                state.snapshot.capabilities.migrate = false;
                state.snapshot.capabilities.create_fresh = false;
                state.snapshot.capabilities.retry = false;
                state.snapshot.capabilities.continue_startup = false;
            }
            if state.handoff_started {
                state.snapshot.capabilities.continue_startup = false;
                state.snapshot.capabilities.exit = false;
            }
            state.snapshot.clone()
        };
        let _ = app.emit("moon://startup-state", &snapshot);
        snapshot
    }
    pub fn configure(
        &self,
        context: &mut tauri::Context<tauri::Wry>,
    ) -> tauri::utils::config::WindowConfig {
        let mut window = context
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .cloned()
            .unwrap_or_default();
        for window in &mut context.config_mut().app.windows {
            window.create = false;
        }
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(self.control.join("startup")),
        );
        window.label = "startup".into();
        window.url = tauri::WebviewUrl::App("index.html?moon-startup=1".into());
        window.width = 680.0;
        window.height = 560.0;
        window.min_width = Some(520.0);
        window.min_height = Some(420.0);
        window.center = true;
        window.data_directory = None;
        window
    }
    fn record_for(&self, target: &str, previous: &Value, selection: &StartupSelection) -> Value {
        let kind = if matches!(selection, StartupSelection::Fresh) {
            "initialize"
        } else {
            "migration"
        };
        if previous["committed"] == false
            && previous["kind"] == kind
            && previous["targetDirectory"]
                .as_str()
                .is_some_and(|path| same(Path::new(path), Path::new(target)))
        {
            return previous.clone();
        }
        let mut retained = validated_retained(previous);
        // 换目标只建立新操作，旧同次目标和暂存必须仍可见，不能扫描或接管陌生目录。
        if let Some(old) = previous["targetDirectory"].as_str() {
            let target = PathBuf::from(old);
            let stage = target.parent().map(|parent| {
                parent.join(format!(
                    ".Moon迁移-{}",
                    previous["operationId"].as_str().unwrap_or_default()
                ))
            });
            for path in std::iter::once(target).chain(stage) {
                if owned_copy(&path, previous) {
                    retained.push(storage::text(&path));
                }
            }
        }
        retained.sort();
        retained.dedup();
        for path in [&self.source, &self.legacy_profile] {
            if path.is_dir() {
                retained.push(storage::text(path));
            }
        }
        retained.sort();
        retained.dedup();
        json!({"operationId":uuid::Uuid::new_v4().to_string(),"kind":kind,"legacy":kind=="migration","sourceDirectory":storage::text(&self.source),"legacyProfileDirectory":storage::text(&self.legacy_profile),"legacyTempDirectory":storage::text(&self.legacy_temp),"targetDirectory":target,"installDirectory":storage::text(&self.install),"controlDirectory":storage::text(&self.control),"bootstrapFile":storage::text(&self.bootstrap_file),"dataSetId":uuid::Uuid::new_v4().to_string(),"targetVersion":env!("CARGO_PKG_VERSION"),"generation":0,"committed":false,"shutdownStarted":false,"phase":"preparing","retainedCopies":retained})
    }
    fn persist(&self, record: &Value) -> Result<(), String> {
        let id = record["operationId"]
            .as_str()
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
            .ok_or("首启操作身份无效。")?;
        storage::atomic_json(&self.control.join(format!("{id}.json")), record)?;
        storage::atomic_json(&self.control.join("last-maintenance.json"), record)
    }
    pub fn invalidate_choice(&self, app: &AppHandle, choice: &str) -> DesktopResult<()> {
        let _action = self
            .actions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if !self.snapshot().capabilities.choose_directory {
            return Err(busy());
        }
        if !same(
            Path::new(choice),
            Path::new(&self.snapshot().target_directory),
        ) {
            self.change(app, |inner| {
                inner.plan = None;
                inner.snapshot.plan_id = None;
                inner.snapshot.plan_expires_at = None;
                inner.snapshot.phase = StartupPhase::AwaitingConfirmation;
            });
        }
        Ok(())
    }
    pub fn prepare(
        &self,
        app: &AppHandle,
        input: MigrationPrepareInput,
    ) -> DesktopResult<StartupSnapshot> {
        let _action = self
            .actions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        self.prepare_locked(app, input, StartupSelection::Import)
    }
    pub fn prepare_fresh(
        &self,
        app: &AppHandle,
        input: MigrationPrepareInput,
    ) -> DesktopResult<StartupSnapshot> {
        let _action = self.actions.lock().unwrap_or_else(|p| p.into_inner());
        self.prepare_locked(app, input, StartupSelection::Fresh)
    }
    // 调用者持有actions：重试的原身份校验、完整预检及开始必须在同一动作锁内。
    fn prepare_locked(
        &self,
        app: &AppHandle,
        input: MigrationPrepareInput,
        selection: StartupSelection,
    ) -> DesktopResult<StartupSnapshot> {
        if !self.snapshot().capabilities.prepare {
            return Err(busy());
        }
        if self.bootstrap_file.exists()
            || has_committed_record(&self.install, &self.control).unwrap_or(true)
        {
            return Err(issue(
                IssueCode::Validation,
                "已有登记或已提交数据，不能建立另一套首次数据；请恢复原引导。",
                RecoveryAction::None,
            ));
        }
        self.change(app, |inner| {
            inner.plan = None;
            inner.snapshot.plan_id = None;
            inner.snapshot.plan_expires_at = None;
            inner.snapshot.operation_id = None;
            inner.snapshot.target_directory = input.target_directory.clone();
            inner.snapshot.phase = StartupPhase::Preparing;
            inner.snapshot.selection = Some(selection.clone());
            inner.snapshot.issue = None;
            inner.snapshot.file_count = None;
            inner.snapshot.total_bytes = None;
            inner.snapshot.available_bytes = None;
        });
        if input.target_directory.len() > 4096 || !Path::new(&input.target_directory).is_absolute()
        {
            return Ok(self.fail(
                app,
                migration::failure(
                    StartupIssueCode::TargetInvalid,
                    StartupFailureStage::Target,
                    "请选择绝对路径的新专用数据目录。",
                    None,
                ),
                false,
            ));
        }
        let target = PathBuf::from(&input.target_directory);
        if let Err(message) = storage::reject_links(&target) {
            return Ok(self.fail(
                app,
                migration::failure(
                    StartupIssueCode::TargetInvalid,
                    StartupFailureStage::Target,
                    message,
                    Some(&target),
                ),
                false,
            ));
        }
        let normalized = if target.exists() {
            dunce::canonicalize(&target)
        } else {
            target
                .parent()
                .ok_or_else(|| std::io::Error::other("invalid parent"))
                .and_then(dunce::canonicalize)
                .map(|parent| parent.join(target.file_name().unwrap_or_default()))
        };
        let Ok(normalized) = normalized else {
            return Ok(self.fail(
                app,
                migration::failure(
                    StartupIssueCode::TargetInvalid,
                    StartupFailureStage::Target,
                    "目标父目录不存在或不可访问。",
                    Some(&target),
                ),
                false,
            ));
        };
        let target = storage::text(&normalized);
        let plan_id = uuid::Uuid::new_v4().to_string();
        let previous = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .record
            .clone();
        let mut record = self.record_for(&target, &previous, &selection);
        self.change(app, |inner| {
            inner.record = record.clone();
            inner.snapshot.operation_id = record["operationId"].as_str().map(str::to_owned);
            inner.snapshot.target_directory = target.clone();
            inner.snapshot.retained_copy_directories = validated_retained(&record);
        });
        record["previewPlanId"] = json!(plan_id);
        let file = self.control.join(format!("preview-{plan_id}.json"));
        if let Err(message) = storage::atomic_json(&file, &record) {
            return Ok(self.fail(
                app,
                migration::failure(
                    StartupIssueCode::Permission,
                    StartupFailureStage::Target,
                    message,
                    Some(&self.control),
                ),
                false,
            ));
        }
        let checked = migration::worker_detailed(&self.install, "--prepare", &file, |_| Ok(()));
        let _ = fs::remove_file(&file);
        record
            .as_object_mut()
            .map(|record| record.remove("previewPlanId"));
        match checked {
            Ok(value) => {
                let operation = record["operationId"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                let expires = (OffsetDateTime::now_utc() + time::Duration::minutes(5))
                    .format(&Rfc3339)
                    .ok();
                Ok(self.change(app, |inner| {
                    inner.record = record;
                    inner.plan = Some(Plan {
                        id: plan_id.clone(),
                        target: target.clone(),
                        operation: operation.clone(),
                        selection,
                        deadline: Instant::now() + Duration::from_secs(300),
                    });
                    inner.snapshot.phase = StartupPhase::Ready;
                    inner.snapshot.operation_id = Some(operation);
                    inner.snapshot.plan_id = Some(plan_id);
                    inner.snapshot.plan_expires_at = expires;
                    inner.snapshot.target_directory = target;
                    inner.snapshot.file_count = value["fileCount"].as_u64();
                    inner.snapshot.total_bytes = value["totalBytes"].as_u64();
                    inner.snapshot.available_bytes = value["availableBytes"].as_u64();
                    inner.snapshot.issue = None;
                }))
            }
            Err(issue) => Ok(self.fail(app, issue, false)),
        }
    }
    fn fail(&self, app: &AppHandle, mut failure: StartupIssue, persist: bool) -> StartupSnapshot {
        log::warn!(
            "首启迁移未完成：阶段={:?}，原因={:?}，{}",
            failure.stage,
            failure.code,
            failure.message
        );
        let mut record = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .record
            .clone();
        if let Some(id) = record["operationId"]
            .as_str()
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        {
            if let Ok(saved) = storage::read_json(&self.control.join(format!("{id}.json"))) {
                if saved["operationId"] == record["operationId"]
                    && saved["dataSetId"] == record["dataSetId"]
                {
                    record = saved;
                }
            }
        }
        let committed = committed(&self.bootstrap_file, &record);
        if committed {
            failure.stage = StartupFailureStage::Opening;
            failure.message = if record["kind"] == "initialize" { "新数据集已建立，但维护记录或启动交接未完成。请检查程序目录权限后启动Moon；旧数据保留，不会重新初始化。" } else { "数据文件已迁移并提交，但维护记录或启动交接未完成。请检查程序目录权限后启动 Moon；不会重复复制旧数据。" }.into();
            record["committed"] = json!(true);
            record["generation"] = json!(1);
        }
        if persist {
            record["phase"] = json!(if committed { "handedOff" } else { "failed" });
            record["startupIssue"] = json!(&failure);
            record["message"] = json!(&failure.message);
            let _ = self.persist(&record);
        }
        self.change(app, |inner| {
            inner.snapshot.retained_copy_directories = validated_retained(&record);
            inner.record = record;
            inner.plan = None;
            inner.snapshot.plan_id = None;
            inner.snapshot.plan_expires_at = None;
            inner.snapshot.phase = if committed {
                StartupPhase::ReadyToOpen
            } else {
                StartupPhase::Failed
            };
            inner.snapshot.issue = Some(failure);
        })
    }
    pub fn start(
        self: &Arc<Self>,
        app: &AppHandle,
        input: StartupStartInput,
    ) -> DesktopResult<StartupSnapshot> {
        let _action = self
            .actions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        self.start_locked(app, input, StartupSelection::Import)
    }
    pub fn start_fresh(
        self: &Arc<Self>,
        app: &AppHandle,
        input: StartupStartInput,
    ) -> DesktopResult<StartupSnapshot> {
        let _action = self.actions.lock().unwrap_or_else(|p| p.into_inner());
        self.start_locked(app, input, StartupSelection::Fresh)
    }
    fn start_locked(
        self: &Arc<Self>,
        app: &AppHandle,
        input: StartupStartInput,
        selection: StartupSelection,
    ) -> DesktopResult<StartupSnapshot> {
        let snapshot = self.snapshot();
        if matches!(
            snapshot.phase,
            StartupPhase::Inspecting
                | StartupPhase::Copying
                | StartupPhase::Validating
                | StartupPhase::Committing
        ) && snapshot.plan_id.as_deref() == Some(&input.plan_id)
            && snapshot.selection.as_ref() == Some(&selection)
            && same(
                Path::new(&snapshot.target_directory),
                Path::new(&input.target_directory),
            )
        {
            return Ok(snapshot);
        }
        let expired = {
            let inner = self
                .inner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            inner
                .plan
                .as_ref()
                .is_some_and(|plan| plan.id == input.plan_id && Instant::now() >= plan.deadline)
        };
        if expired {
            return Ok(self.fail(
                app,
                migration::failure(
                    StartupIssueCode::PlanExpired,
                    StartupFailureStage::Target,
                    "迁移计划超过五分钟，请重新检查目标目录后确认迁移。",
                    None,
                ),
                false,
            ));
        }
        let valid = {
            let inner = self
                .inner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            inner.plan.as_ref().is_some_and(|plan| {
                plan.id == input.plan_id
                    && same(Path::new(&plan.target), Path::new(&input.target_directory))
                    && inner.snapshot.operation_id.as_deref() == Some(&plan.operation)
                    && plan.selection == selection
                    && inner.snapshot.selection.as_ref() == Some(&selection)
                    && Instant::now() < plan.deadline
            })
        };
        if !valid || !matches!(snapshot.phase, StartupPhase::Ready) {
            return Err(issue(
                IssueCode::Validation,
                "迁移计划已失效或目标变化，请重新检查当前目标。",
                RecoveryAction::Retry,
            ));
        }
        if self.bootstrap_file.exists()
            || has_committed_record(&self.install, &self.control).unwrap_or(true)
        {
            return Err(issue(
                IssueCode::Validation,
                "已有登记数据，当前首次启动计划已失效；不能重新初始化或复制。",
                RecoveryAction::None,
            ));
        }
        let mut record = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .record
            .clone();
        record["shutdownStarted"] = json!(true);
        record["parentPid"] = json!(std::process::id());
        record["phase"] = json!(if matches!(selection, StartupSelection::Fresh) {
            "committing"
        } else {
            "inspecting"
        });
        record["committed"] = json!(false);
        if let Err(message) = self.persist(&record) {
            return Ok(self.fail(
                app,
                migration::failure(
                    StartupIssueCode::StorageIo,
                    StartupFailureStage::Inspecting,
                    message,
                    Some(&self.control),
                ),
                true,
            ));
        }
        let current = self.change(app, |inner| {
            inner.record = record;
            inner.snapshot.phase = if matches!(selection, StartupSelection::Fresh) {
                StartupPhase::Committing
            } else {
                StartupPhase::Inspecting
            };
            inner.snapshot.issue = None;
            inner.snapshot.completed_files = 0;
            inner.snapshot.copied_bytes = Some(0);
        });
        let service = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if matches!(selection, StartupSelection::Fresh) {
                service.execute_fresh(&app);
            } else {
                service.execute(&app);
            }
        });
        Ok(current)
    }
    pub fn retry(
        self: &Arc<Self>,
        app: &AppHandle,
        input: StartupOperationInput,
    ) -> DesktopResult<StartupSnapshot> {
        let _action = self
            .actions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let current = self.snapshot();
        if !current.capabilities.retry
            || current.operation_id.as_deref() != Some(&input.operation_id)
        {
            return Err(busy());
        }
        let prepared = self.prepare_locked(
            app,
            MigrationPrepareInput {
                target_directory: current.target_directory,
            },
            current
                .selection
                .clone()
                .unwrap_or(StartupSelection::Import),
        )?;
        if let Some(plan_id) = prepared.plan_id {
            self.start_locked(
                app,
                StartupStartInput {
                    plan_id,
                    target_directory: prepared.target_directory,
                },
                prepared.selection.unwrap_or(StartupSelection::Import),
            )
        } else {
            Ok(prepared)
        }
    }
    fn execute(&self, app: &AppHandle) {
        let record = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .record
            .clone();
        let id = record["operationId"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let file = self.control.join(format!("{id}.json"));
        let target = PathBuf::from(record["targetDirectory"].as_str().unwrap_or_default());
        let result = (|| -> Result<(), StartupIssue> {
            windows_guard::require_single_user_session().map_err(|message| {
                migration::failure(
                    StartupIssueCode::SourceBusy,
                    StartupFailureStage::Source,
                    message,
                    Some(&self.source),
                )
            })?;
            storage::validate_tree(&self.source).map_err(|message| {
                migration::failure(
                    StartupIssueCode::SourceInvalid,
                    StartupFailureStage::Source,
                    message,
                    Some(&self.source),
                )
            })?;
            migration::ensure_profile_released(&self.legacy_profile).map_err(|message| {
                migration::failure(
                    StartupIssueCode::SourceBusy,
                    StartupFailureStage::Source,
                    message,
                    Some(&self.legacy_profile),
                )
            })?;
            let inspected =
                migration::worker_detailed(&self.install, "--inspect", &file, |_| Ok(()))?;
            storage::private_directory(&target, true).map_err(|message| {
                migration::failure(
                    StartupIssueCode::Permission,
                    StartupFailureStage::Target,
                    message,
                    Some(&target),
                )
            })?;
            self.change(app, |inner| {
                inner.snapshot.phase = StartupPhase::Copying;
                inner.snapshot.file_count = inspected["fileCount"].as_u64();
                inner.snapshot.total_bytes = inspected["totalBytes"].as_u64();
                inner.snapshot.available_bytes = inspected["availableBytes"].as_u64();
            });
            let copied = migration::worker_detailed(&self.install, "--copy", &file, |value| {
                if value["phase"].is_string() {
                    self.change(app, |inner| {
                        if inner.snapshot.operation_id.as_deref() == Some(&id) {
                            inner.snapshot.phase = if value["phase"] == "validating" {
                                StartupPhase::Validating
                            } else {
                                StartupPhase::Copying
                            };
                            inner.snapshot.completed_files = value["completedFiles"]
                                .as_u64()
                                .unwrap_or(inner.snapshot.completed_files);
                            inner.snapshot.copied_bytes = value["copiedBytes"]
                                .as_u64()
                                .or(inner.snapshot.copied_bytes);
                            if let Ok(paths) = serde_json::from_value::<Vec<String>>(
                                value["retainedCopies"].clone(),
                            ) {
                                inner.snapshot.retained_copy_directories = paths;
                            }
                        }
                    });
                }
                Ok(())
            })?;
            storage::private_directory(&target, false).map_err(|message| {
                migration::failure(
                    StartupIssueCode::Permission,
                    StartupFailureStage::Validating,
                    message,
                    Some(&target),
                )
            })?;
            let marker: DataMarker = serde_json::from_value(
                storage::read_json(&target.join("moon-data.json")).map_err(|message| {
                    migration::failure(
                        StartupIssueCode::DataInvalid,
                        StartupFailureStage::Validating,
                        message,
                        Some(&target),
                    )
                })?,
            )
            .map_err(|_| {
                migration::failure(
                    StartupIssueCode::DataInvalid,
                    StartupFailureStage::Validating,
                    "复制目标的数据集标记无效。",
                    Some(&target),
                )
            })?;
            if record["dataSetId"] != marker.data_set_id
                || marker.schema_version != 1
                || !compatible(&marker.minimum_app_version)
                || !owned_copy(&target, &record)
            {
                return Err(migration::failure(
                    StartupIssueCode::DataInvalid,
                    StartupFailureStage::Validating,
                    "复制目标的数据集、迁移身份或兼容版本不一致。",
                    Some(&target),
                ));
            }
            self.change(app, |inner| {
                inner.snapshot.phase = StartupPhase::Committing;
            });
            let bootstrap = Bootstrap {
                format_version: 1,
                generation: 1,
                data_root: if same(&target, &self.install.join("data")) {
                    PathBuf::from("data")
                } else {
                    target.clone()
                },
                data_set_id: record["dataSetId"].as_str().unwrap_or_default().to_owned(),
            };
            storage::atomic_json(&self.bootstrap_file, &bootstrap).map_err(|message| {
                migration::failure(
                    StartupIssueCode::StorageIo,
                    StartupFailureStage::Committing,
                    message,
                    Some(&self.bootstrap_file),
                )
            })?;
            let mut record = storage::read_json(&file).map_err(|message| {
                migration::failure(
                    StartupIssueCode::StorageIo,
                    StartupFailureStage::Opening,
                    message,
                    Some(&file),
                )
            })?;
            record["committed"] = json!(true);
            record["generation"] = json!(1);
            record["phase"] = json!("handedOff");
            record["completedFiles"] = copied["fileCount"].clone();
            record["totalFiles"] = copied["fileCount"].clone();
            record["startupIssue"] = Value::Null;
            self.persist(&record).map_err(|message| {
                migration::failure(
                    StartupIssueCode::StorageIo,
                    StartupFailureStage::Opening,
                    message,
                    Some(&self.control),
                )
            })?;
            self.change(app, |inner| {
                inner.record = record;
                inner.plan = None;
                inner.snapshot.plan_id = None;
                inner.snapshot.plan_expires_at = None;
                inner.snapshot.phase = StartupPhase::ReadyToOpen;
                inner.snapshot.completed_files = copied["fileCount"]
                    .as_u64()
                    .unwrap_or(inner.snapshot.completed_files);
                inner.snapshot.copied_bytes = copied["totalBytes"].as_u64();
                inner.snapshot.issue = None;
            });
            Ok(())
        })();
        if let Err(issue) = result {
            self.fail(app, issue, true);
        }
    }
    /// 不导入与复制是两个操作身份。这里只创建新的空存储，不触碰旧业务/profile或失败副本。
    fn execute_fresh(&self, app: &AppHandle) {
        let mut record = self
            .inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .record
            .clone();
        let target = PathBuf::from(record["targetDirectory"].as_str().unwrap_or_default());
        let result = (|| -> Result<(), StartupIssue> {
            let failure = |message: String| {
                migration::failure(
                    StartupIssueCode::StorageIo,
                    StartupFailureStage::Committing,
                    message,
                    Some(&target),
                )
            };
            if record["kind"] != "initialize"
                || self.bootstrap_file.exists()
                || has_committed_record(&self.install, &self.control).unwrap_or(true)
            {
                return Err(failure("已有登记数据，不能创建新的首次数据集。".into()));
            }
            // 元数据预检再执行一次，确保确认后目标未被其他内容占用；不读取旧业务内容。
            // worker预检只认可preview身份；正式op记录不能伪装为preview，更不能放宽来源校验。
            let preview_id = uuid::Uuid::new_v4().to_string();
            let preview_file = self.control.join(format!("preview-{preview_id}.json"));
            let mut preview = record.clone();
            preview["previewPlanId"] = json!(&preview_id);
            storage::atomic_json(&preview_file, &preview).map_err(failure)?;
            let checked =
                migration::worker_detailed(&self.install, "--prepare", &preview_file, |_| Ok(()));
            let _ = fs::remove_file(&preview_file);
            checked?;
            let existed = target.exists()
                && fs::read_dir(&target).is_ok_and(|mut entries| entries.next().is_some());
            if existed {
                validate_fresh_tree(&target, &record).map_err(failure)?;
            }
            storage::private_directory(&target, true).map_err(failure)?;
            if !existed {
                storage::atomic_json(&target.join(".moon-migration.json"), &json!({
                    "operationId":record["operationId"],"dataSetId":record["dataSetId"],"kind":"initialize"
                })).map_err(failure)?;
            }
            let _data_lease =
                storage::exclusive(&target.join(".moon-data.lock")).map_err(failure)?;
            let marker = DataMarker {
                data_set_id: record["dataSetId"].as_str().unwrap_or_default().to_owned(),
                schema_version: 1,
                minimum_app_version: env!("CARGO_PKG_VERSION").into(),
            };
            if target.join("moon-data.json").exists() {
                let existing: DataMarker = serde_json::from_value(
                    storage::read_json(&target.join("moon-data.json")).map_err(failure)?,
                )
                .map_err(|_| failure("新数据集标记无效，原文件保留。".into()))?;
                if existing.data_set_id != marker.data_set_id
                    || existing.schema_version != 1
                    || !compatible(&existing.minimum_app_version)
                {
                    return Err(failure("目标数据集身份与当前初始化操作不一致。".into()));
                }
            } else {
                storage::atomic_json(&target.join("moon-data.json"), &marker).map_err(failure)?;
            }
            for directory in ["tmp", "logs", "updates", "maintenance", "webview", "agent"] {
                fs::create_dir_all(target.join(directory))
                    .map_err(|_| failure("无法建立新数据子目录。".into()))?;
            }
            let retained = validated_retained(&record);
            storage::atomic_json(&target.join("maintenance/retained-copies.json"), &retained)
                .map_err(failure)?;
            validate_fresh_tree(&target, &record).map_err(failure)?;
            storage::private_directory(&target, false).map_err(failure)?;
            // 所有目标身份已验证，bootstrap是最后的权威提交；不能覆盖另一个已登记数据集。
            if self.bootstrap_file.exists() {
                return Err(failure("引导已变化，未提交新数据集。".into()));
            }
            let bootstrap = Bootstrap {
                format_version: 1,
                generation: 1,
                data_root: if same(&target, &self.install.join("data")) {
                    PathBuf::from("data")
                } else {
                    target.clone()
                },
                data_set_id: marker.data_set_id,
            };
            storage::atomic_json(&self.bootstrap_file, &bootstrap).map_err(failure)?;
            if !committed(&self.bootstrap_file, &record) {
                return Err(failure("初始化引导提交未得到身份确认，原文件保留。".into()));
            }
            record["committed"] = json!(true);
            record["generation"] = json!(1);
            record["phase"] = json!("handedOff");
            record["startupIssue"] = Value::Null;
            self.persist(&record).map_err(failure)?;
            self.change(app, |inner| {
                inner.record = record;
                inner.plan = None;
                inner.snapshot.plan_id = None;
                inner.snapshot.plan_expires_at = None;
                inner.snapshot.phase = StartupPhase::ReadyToOpen;
                inner.snapshot.issue = None;
                inner.snapshot.completed_files = 0;
                inner.snapshot.copied_bytes = Some(0);
                inner.snapshot.retained_copy_directories = retained;
            });
            Ok(())
        })();
        if let Err(issue) = result {
            self.fail(app, issue, true);
        }
    }
    pub fn continue_startup(
        &self,
        app: &AppHandle,
        input: StartupOperationInput,
    ) -> DesktopResult<()> {
        let _action = self
            .actions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let snapshot = self.snapshot();
        let record = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .record
            .clone();
        if self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .handoff_started
            && snapshot.operation_id.as_deref() == Some(&input.operation_id)
        {
            return Ok(());
        }
        if !snapshot.capabilities.continue_startup
            || snapshot.operation_id.as_deref() != Some(&input.operation_id)
            || !committed(&self.bootstrap_file, &record)
        {
            return Err(busy());
        }
        self.change(app, |inner| {
            inner.handoff_started = true;
        });
        match spawn_handoff(&self.control, &record) {
            Ok(()) => {
                app.exit(0);
                Ok(())
            }
            Err(message) => {
                self.change(app, |inner| {
                    inner.handoff_started = false;
                });
                self.fail(
                    app,
                    migration::failure(
                        StartupIssueCode::StorageIo,
                        StartupFailureStage::Opening,
                        message,
                        Some(&self.control),
                    ),
                    true,
                );
                Err(issue(
                    IssueCode::Unknown,
                    "数据已经迁移，但启动交接未完成。请读取当前恢复说明。",
                    RecoveryAction::Retry,
                ))
            }
        }
    }
}

fn compatible(version: &str) -> bool {
    semver::Version::parse(version).is_ok_and(|minimum| {
        semver::Version::parse(env!("CARGO_PKG_VERSION")).is_ok_and(|current| current >= minimum)
    })
}
fn has_committed_record(install: &Path, control: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(control).map_err(|_| "无法核对已有数据提交记录。")? {
        let entry = entry.map_err(|_| "无法核对已有数据提交记录。")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name
            .strip_suffix(".json")
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        else {
            continue;
        };
        storage::reject_links(&entry.path())?;
        let record = storage::read_json(&entry.path())?;
        if record["operationId"] == id
            && (record["kind"] == "migration" || record["kind"] == "initialize")
            && record["dataSetId"]
                .as_str()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
            && record["installDirectory"]
                .as_str()
                .is_some_and(|value| same(Path::new(value), install))
            && record["controlDirectory"]
                .as_str()
                .is_some_and(|value| same(Path::new(value), control))
            && (record["committed"] == true
                || record["phase"] == "handedOff"
                || record["phase"] == "succeeded")
        {
            return Ok(true);
        }
    }
    Ok(false)
}
fn validate_fresh_tree(target: &Path, record: &Value) -> Result<(), String> {
    if !owned_copy(target, record)
        || storage::read_json(&target.join(".moon-migration.json"))?["kind"] != "initialize"
    {
        return Err("非当前新数据初始化目标，不能接管。".into());
    }
    storage::validate_tree(target)?;
    for entry in fs::read_dir(target).map_err(|_| "新目标不能读取。")? {
        let entry = entry.map_err(|_| "新目标不能读取。")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        match name.as_str() {
            ".moon-migration.json" | "moon-data.json" | ".moon-data.lock"
                if entry.file_type().is_ok_and(|kind| kind.is_file()) => {}
            "tmp" | "logs" | "updates" | "webview" | "agent"
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) =>
            {
                if fs::read_dir(entry.path())
                    .map_err(|_| "新目标不能读取。")?
                    .next()
                    .is_some()
                {
                    return Err("新目标已含非当前初始化内容，原文件保留，请选择新的空目录。".into());
                }
            }
            "maintenance" if entry.file_type().is_ok_and(|kind| kind.is_dir()) => {
                for file in fs::read_dir(entry.path()).map_err(|_| "初始化记录不能读取。")?
                {
                    let file = file.map_err(|_| "初始化记录不能读取。")?;
                    if file.file_name() != "retained-copies.json"
                        || !file.file_type().is_ok_and(|kind| kind.is_file())
                    {
                        return Err("新目标含陌生维护记录，原文件保留。".into());
                    }
                }
            }
            _ => return Err("新目标含非当前初始化内容，原文件保留，请选择新的空目录。".into()),
        }
    }
    Ok(())
}
fn owned_copy(path: &Path, record: &Value) -> bool {
    if !["operationId", "dataSetId"].iter().all(|key| {
        record[*key]
            .as_str()
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
    }) || !path.is_absolute()
        || storage::reject_links(path).is_err()
    {
        return false;
    }
    storage::read_json(&path.join(".moon-migration.json")).is_ok_and(|marker| {
        marker["operationId"] == record["operationId"] && marker["dataSetId"] == record["dataSetId"]
    })
}
fn validated_retained(record: &Value) -> Vec<String> {
    record["retainedCopies"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|path| {
            let path = Path::new(path);
            if !path.is_absolute() || !path.is_dir() || storage::reject_links(path).is_err() {
                return false;
            }
            if ["sourceDirectory", "legacyProfileDirectory"]
                .iter()
                .any(|key| {
                    record[*key]
                        .as_str()
                        .is_some_and(|root| same(path, Path::new(root)))
                })
            {
                return true;
            }
            // 每条旧副本必须能由同数据集、明确原操作记录证明，不凭目录名或任意扫描接管。
            let Ok(marker) = storage::read_json(&path.join(".moon-migration.json")) else {
                return false;
            };
            let Some(id) = marker["operationId"]
                .as_str()
                .filter(|id| uuid::Uuid::parse_str(id).is_ok())
            else {
                return false;
            };
            if marker["operationId"] == record["operationId"] {
                return marker["dataSetId"] == record["dataSetId"];
            }
            record["controlDirectory"].as_str().is_some_and(|control| {
                storage::read_json(&Path::new(control).join(format!("{id}.json"))).is_ok_and(
                    |previous| {
                        previous["operationId"] == id
                            && previous["dataSetId"] == marker["dataSetId"]
                            && previous["controlDirectory"] == record["controlDirectory"]
                            && previous["installDirectory"] == record["installDirectory"]
                            && previous["sourceDirectory"] == record["sourceDirectory"]
                            && previous["legacyProfileDirectory"]
                                == record["legacyProfileDirectory"]
                    },
                )
            })
        })
        .map(str::to_owned)
        .collect()
}
pub(crate) fn committed(bootstrap_file: &Path, record: &Value) -> bool {
    if !(record["kind"] == "migration" || record["kind"] == "initialize")
        || storage::reject_links(bootstrap_file).is_err()
        || !["operationId", "dataSetId"].iter().all(|key| {
            record[*key]
                .as_str()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
        })
    {
        return false;
    }
    let Ok(bootstrap) = storage::read_json(bootstrap_file).and_then(|value| {
        serde_json::from_value::<Bootstrap>(value).map_err(|_| "引导无效。".into())
    }) else {
        return false;
    };
    let Some(target) = record["targetDirectory"].as_str().map(PathBuf::from) else {
        return false;
    };
    if !target.is_absolute()
        || storage::private_directory(&target, false).is_err()
        || (!bootstrap.data_root.is_absolute() && bootstrap.data_root != Path::new("data"))
    {
        return false;
    }
    let root = if bootstrap.data_root.is_absolute() {
        bootstrap.data_root.clone()
    } else {
        bootstrap_file
            .parent()
            .unwrap_or(Path::new(""))
            .join(&bootstrap.data_root)
    };
    if !same(&root, &target)
        || bootstrap.data_set_id != record["dataSetId"]
        || bootstrap.generation != 1
        || bootstrap.format_version != 1
    {
        return false;
    }
    let Ok(marker) = storage::read_json(&target.join("moon-data.json")).and_then(|value| {
        serde_json::from_value::<DataMarker>(value).map_err(|_| "标记无效。".into())
    }) else {
        return false;
    };
    marker.data_set_id == bootstrap.data_set_id
        && marker.schema_version == 1
        && compatible(&marker.minimum_app_version)
        && owned_copy(&target, record)
        && (record["kind"] != "initialize"
            || storage::read_json(&target.join(".moon-migration.json"))
                .is_ok_and(|marker| marker["kind"] == "initialize"))
}
fn spawn_handoff(control: &Path, original: &Value) -> Result<(), String> {
    let id = original["operationId"]
        .as_str()
        .ok_or("交接操作身份缺失。")?;
    let nonce = uuid::Uuid::new_v4().to_string();
    let mut record = original.clone();
    record["startupHandoffNonce"] = json!(nonce);
    record["startupParentPid"] = json!(std::process::id());
    storage::atomic_json(&control.join(format!("{id}.json")), &record)?;
    let mut command =
        std::process::Command::new(std::env::current_exe().map_err(|_| "无法定位交接程序。")?);
    command.args(["--moon-startup-handoff", id, &nonce]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动交接进程；数据已迁移，请手动重新打开Moon。")?;
    let handshake = (|| -> Result<(), String> {
        for _ in 0..200 {
            if storage::read_json(&control.join(format!("{id}.startup-ready"))).is_ok_and(|ready| {
                ready["operationId"] == id
                    && ready["nonce"] == nonce
                    && ready["helperPid"].as_u64() == Some(child.id() as u64)
            }) {
                return Ok(());
            }
            if child
                .try_wait()
                .map_err(|_| "无法确认交接进程。")?
                .is_some()
            {
                return Err("启动交接进程未建立屏障，数据已迁移，请重新打开Moon。".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Err("启动交接握手超时；数据已迁移，请退出其他Moon后重新打开。".into())
    })();
    if handshake.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    handshake
}
pub fn handoff_entry() -> Result<bool, String> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) != Some("--moon-startup-handoff") {
        return Ok(false);
    }
    let id = args
        .get(2)
        .filter(|value| uuid::Uuid::parse_str(value).is_ok())
        .ok_or("启动交接身份无效。")?;
    let nonce = args
        .get(3)
        .filter(|value| uuid::Uuid::parse_str(value).is_ok())
        .ok_or("启动交接nonce无效。")?;
    let install = dunce::canonicalize(
        std::env::current_exe()
            .map_err(|_| "无法定位交接程序。")?
            .parent()
            .ok_or("程序目录无效。")?,
    )
    .map_err(|_| "程序目录无效。")?;
    let control = install.join(".moon-control");
    storage::private_directory(&control, false)?;
    let file = control.join(format!("{id}.json"));
    let mut record = storage::read_json(&file)?;
    if record["operationId"] != id.as_str()
        || record["startupHandoffNonce"] != nonce.as_str()
        || !record["controlDirectory"]
            .as_str()
            .is_some_and(|path| same(Path::new(path), &control))
        || !record["installDirectory"]
            .as_str()
            .is_some_and(|path| same(Path::new(path), &install))
        || !committed(&install.join("moon.bootstrap.json"), &record)
    {
        return Err("启动交接记录身份或提交事实不一致。".into());
    }
    let result = (|| -> Result<(), String> {
        let parent = record["startupParentPid"]
            .as_u64()
            .and_then(|pid| u32::try_from(pid).ok())
            .filter(|pid| *pid != 0 && *pid != std::process::id())
            .ok_or("启动交接父进程无效。")?;
        let guard = windows_guard::Guard::create(true)?;
        storage::atomic_json(
            &control.join(format!("{id}.startup-ready")),
            &json!({"operationId":id,"nonce":nonce,"helperPid":std::process::id()}),
        )?;
        windows_guard::wait_parent(parent)?;
        let lock = storage::exclusive(&control.join("installation.lock"))?;
        let fresh = storage::read_json(&file)?;
        if fresh["startupHandoffNonce"] != nonce.as_str()
            || fresh["startupParentPid"] != record["startupParentPid"]
            || !committed(&install.join("moon.bootstrap.json"), &fresh)
        {
            return Err("启动交接身份或数据根发生变化，请手动重新打开Moon。".into());
        }
        record = fresh;
        // 复用普通启动的单实例/根租约。此处没有承诺连续通知屏障；交接争用绝不回到复制。
        drop(lock);
        drop(guard);
        let mut command =
            std::process::Command::new(std::env::current_exe().map_err(|_| "无法定位Moon。")?);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
            .spawn()
            .map_err(|_| "数据已迁移，但Moon程序未能启动，请手动重新打开安装版。")?;
        Ok(())
    })();
    if let Err(message) = result {
        // 已提交后的所有失败都只记录opening；不退回源、不再迁移。
        record["startupIssue"] = json!(migration::failure(
            StartupIssueCode::StorageIo,
            StartupFailureStage::Opening,
            &message,
            Some(&install)
        ));
        record["message"] = json!(&message);
        record["phase"] = json!("handedOff");
        let _ = storage::atomic_json(&file, &record);
        let _ = storage::atomic_json(&control.join("last-maintenance.json"), &record);
        return Err(message);
    }
    Ok(true)
}
pub fn service(app: &AppHandle) -> DesktopResult<Arc<StartupGate>> {
    app.try_state::<Arc<StartupGate>>()
        .map(|value| value.inner().clone())
        .ok_or_else(|| {
            issue(
                IssueCode::Unavailable,
                "当前程序不处于首启迁移模式。",
                RecoveryAction::None,
            )
        })
}
