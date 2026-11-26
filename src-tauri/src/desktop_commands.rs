use crate::{
    desktop_contract_generated::*,
    desktop_runtime::{DesktopResult, DesktopRuntime, issue},
    migration,
    models::ModelBackend,
    storage::{self, DataMarker},
};
use serde_json::{Value, json};
use std::{path::PathBuf, process::Command, time::Duration};
use tauri::{AppHandle, Manager, State};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

fn migration_issue(error: StartupIssue) -> DesktopIssue {
    let (code, recovery) = match error.code {
        StartupIssueCode::SourceBusy => (IssueCode::Busy, RecoveryAction::Wait),
        StartupIssueCode::Permission => (IssueCode::Permission, RecoveryAction::Retry),
        StartupIssueCode::TargetInvalid
        | StartupIssueCode::InsufficientSpace
        | StartupIssueCode::PlanExpired => (IssueCode::Validation, RecoveryAction::ChooseDirectory),
        StartupIssueCode::RuntimeIncompatible => (IssueCode::Compatibility, RecoveryAction::None),
        StartupIssueCode::RuntimeMissing | StartupIssueCode::DependencyMissing => {
            (IssueCode::Unavailable, RecoveryAction::None)
        }
        StartupIssueCode::StorageIo => (IssueCode::Unknown, RecoveryAction::Retry),
        StartupIssueCode::Internal => (IssueCode::Internal, RecoveryAction::Retry),
        _ => (IssueCode::Validation, RecoveryAction::Retry),
    };
    issue(
        code,
        error.message,
        if error.retryable {
            recovery
        } else {
            RecoveryAction::None
        },
    )
}

#[tauri::command]
pub fn desktop_get_state(service: State<'_, DesktopRuntime>) -> DesktopSnapshot {
    service.snapshot()
}
#[tauri::command]
pub async fn storage_measure_capacity(
    service: State<'_, DesktopRuntime>,
    input: StorageCapacityInput,
) -> DesktopResult<StorageCapacity> {
    let current = || {
        let snapshot = service.snapshot();
        if snapshot.storage.data_set_id != input.data_set_id
            || snapshot.storage.generation != input.generation
        {
            return Err(issue(
                IssueCode::Validation,
                "数据目录身份已变化，请刷新存储状态。",
                RecoveryAction::Retry,
            ));
        }
        if snapshot.maintenance.writes_frozen {
            return Err(issue(
                IssueCode::Busy,
                "维护期间暂停统计容量。",
                RecoveryAction::Wait,
            ));
        }
        Ok(())
    };
    current()?;
    let path = service.paths.data.clone();
    let result = tauri::async_runtime::spawn_blocking(move || storage::measure_capacity(&path))
        .await
        .map_err(|_| {
            issue(
                IssueCode::Internal,
                "容量统计未完成，请重试。",
                RecoveryAction::Retry,
            )
        })?;
    current()?;
    let used_bytes =
        result.map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Retry))?;
    Ok(StorageCapacity { used_bytes })
}

pub(crate) fn open_directory(path: &str) -> DesktopResult<()> {
    let path = PathBuf::from(path);
    storage::reject_links(&path)
        .map_err(|message| issue(IssueCode::Validation, message, RecoveryAction::None))?;
    if !path.is_dir() {
        return Err(issue(
            IssueCode::Validation,
            "目录不存在，原记录保留。",
            RecoveryAction::None,
        ));
    }
    let mut command = Command::new(if cfg!(windows) {
        "explorer.exe"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    });
    command.arg(dunce::simplified(&path));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|_| {
        issue(
            IssueCode::Permission,
            "无法打开数据目录。",
            RecoveryAction::Retry,
        )
    })?;
    Ok(())
}
#[tauri::command]
pub fn desktop_open_data_directory(service: State<'_, DesktopRuntime>) -> DesktopResult<()> {
    open_directory(&storage::text(&service.paths.data))
}
#[tauri::command]
pub fn desktop_open_log_directory(service: State<'_, DesktopRuntime>) -> DesktopResult<()> {
    open_directory(&storage::text(&service.paths.data.join("logs")))
}
#[tauri::command]
pub async fn desktop_export_diagnostics(
    service: State<'_, DesktopRuntime>,
) -> DesktopResult<Option<String>> {
    let snapshot = service.snapshot();
    let report = json!({
        "version": snapshot.version,
        "platform": snapshot.platform,
        "architecture": snapshot.architecture,
        "development": snapshot.development,
        "storageSource": snapshot.storage.source,
        "storageSchemaVersion": snapshot.storage.schema_version,
        "maintenanceKind": snapshot.maintenance.kind,
        "maintenancePhase": snapshot.maintenance.phase,
        "maintenanceIssueCode": snapshot.maintenance.issue.map(|issue| issue.code),
        "updatePhase": snapshot.update.phase,
        "updateIssueCode": snapshot.update.error.map(|error| error.code),
    });
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("导出 Moon 脱敏诊断")
            .add_filter("JSON", &["json"])
            .set_file_name("moon-diagnostics.json")
            .save_file()
        else {
            return Ok(None);
        };
        storage::reject_links(&path).map_err(|_| {
            issue(
                IssueCode::Validation,
                "请选择普通保存目录和文件。",
                RecoveryAction::Retry,
            )
        })?;
        storage::atomic_json(&path, &report).map_err(|_| {
            issue(
                IssueCode::Permission,
                "无法保存脱敏诊断文件。",
                RecoveryAction::Retry,
            )
        })?;
        Ok(Some(storage::text(&path)))
    })
    .await
    .map_err(|_| {
        issue(
            IssueCode::Internal,
            "导出诊断未完成。",
            RecoveryAction::Retry,
        )
    })?
}
#[tauri::command]
pub fn desktop_open_retained_copy(
    service: State<'_, DesktopRuntime>,
    input: RetainedCopyInput,
) -> DesktopResult<()> {
    let snapshot = service.snapshot();
    let path = snapshot
        .storage
        .retained_copy_directories
        .get(input.index as usize)
        .ok_or_else(|| {
            issue(
                IssueCode::Validation,
                "旧副本序号无效。",
                RecoveryAction::None,
            )
        })?;
    open_directory(path)
}
#[tauri::command]
pub async fn desktop_choose_data_directory() -> DesktopResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择Moon新的专用空数据目录")
            .pick_folder()
            .map(|path| storage::text(&path))
    })
    .await
    .map_err(|_| issue(IssueCode::Internal, "目录选择失败。", RecoveryAction::Retry))
}
fn validate_migration_environment(snapshot: &DesktopSnapshot) -> DesktopResult<()> {
    if !snapshot.capabilities.migrate_data {
        return Err(issue(
            IssueCode::Unavailable,
            "当前开发环境指定了数据根，请修改开发启动环境后重启；此模式不能在设置变更数据目录。",
            RecoveryAction::None,
        ));
    }
    if snapshot.maintenance.writes_frozen
        || matches!(
            snapshot.update.phase,
            UpdatePhase::Downloading | UpdatePhase::Installing
        )
    {
        return Err(issue(
            IssueCode::Busy,
            "另一项维护正在进行。",
            RecoveryAction::Wait,
        ));
    }
    Ok(())
}

fn normalize_new_target_directory(target_directory: &str) -> DesktopResult<(PathBuf, String)> {
    if target_directory.len() > 4096 || !PathBuf::from(target_directory).is_absolute() {
        return Err(issue(
            IssueCode::Validation,
            "请选择绝对路径的新专用空目录。",
            RecoveryAction::ChooseDirectory,
        ));
    }
    let requested = PathBuf::from(target_directory);
    storage::reject_links(&requested).map_err(|message| {
        issue(
            IssueCode::Validation,
            message,
            RecoveryAction::ChooseDirectory,
        )
    })?;
    let normalized = if requested.exists() {
        dunce::canonicalize(&requested)
    } else {
        requested
            .parent()
            .ok_or_else(|| {
                issue(
                    IssueCode::Validation,
                    "目标目录无效。",
                    RecoveryAction::ChooseDirectory,
                )
            })?
            .canonicalize()
            .map(|parent| parent.join(requested.file_name().unwrap_or_default()))
    }
    .map_err(|_| {
        issue(
            IssueCode::Validation,
            "目标父目录不存在。",
            RecoveryAction::ChooseDirectory,
        )
    })?;
    let text = storage::text(&normalized);
    Ok((normalized, text))
}

fn inspect_and_build_plan(
    app: &AppHandle,
    service: &DesktopRuntime,
    id: String,
    source_directory: String,
    normalized_target: PathBuf,
    target_directory: String,
    data_set_id: String,
    record: Value,
) -> DesktopResult<MigrationPlan> {
    let file = migration::record_file(&service.paths, &id);
    storage::atomic_json(&file, &record)
        .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Retry))?;
    let inspected =
        migration::worker(&service.paths, "--inspect", &file).map_err(migration_issue)?;
    storage::private_directory(&normalized_target, true).map_err(|message| {
        issue(
            IssueCode::Permission,
            message,
            RecoveryAction::ChooseDirectory,
        )
    })?;
    let state = app
        .state::<ModelBackend>()
        .internal(
            "$maintenance",
            json!({"action":"inspect","operationId":id,"stopActive":false}),
            Duration::from_secs(30),
        )
        .map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Restart))?;
    let plan = MigrationPlan {
        plan_id: id,
        source_directory,
        target_directory,
        data_set_id,
        generation: service.paths.bootstrap.generation,
        file_count: inspected["fileCount"].as_u64().unwrap_or(0),
        total_bytes: inspected["totalBytes"].as_u64().unwrap_or(0),
        expires_at: (OffsetDateTime::now_utc() + time::Duration::minutes(5))
            .format(&Rfc3339)
            .unwrap_or_default(),
        activities: serde_json::from_value(state["activities"].clone()).map_err(|_| {
            issue(
                IssueCode::Unknown,
                "后端活动报告损坏，未认定空闲。",
                RecoveryAction::Restart,
            )
        })?,
    };
    *service
        .plan
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some(plan.clone());
    Ok(plan)
}

#[tauri::command]
pub async fn storage_prepare_migration(
    app: AppHandle,
    input: MigrationPrepareInput,
) -> DesktopResult<MigrationPlan> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<DesktopRuntime>();
        let _request = service
            .maintenance_requests
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let snapshot = service.snapshot();
        validate_migration_environment(&snapshot)?;
        let (normalized, target_directory) =
            normalize_new_target_directory(&input.target_directory)?;
        // 同一未提交迁移可由真实设置入口显式重试；重建当前冻结源，绝不重放unknown业务请求。
        let id = std::fs::read_dir(&service.paths.control)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter_map(|entry| storage::read_json(&entry.path()).ok())
            .find(|record| {
                record["kind"] == "migration"
                    && record["committed"] == false
                    && record["dataSetId"] == service.paths.marker.data_set_id
                    && record["generation"] == service.paths.bootstrap.generation
                    && record["sourceDirectory"] == storage::text(&service.paths.data)
                    && record["targetDirectory"].as_str().is_some_and(|target| {
                        PathBuf::from(target) == PathBuf::from(&target_directory)
                    })
            })
            .and_then(|record| {
                record["operationId"]
                    .as_str()
                    .filter(|id| uuid::Uuid::parse_str(id).is_ok())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let record = migration::migration_record(&service.paths, &id, &target_directory);
        inspect_and_build_plan(
            &app,
            &service,
            id,
            storage::text(&service.paths.data),
            normalized,
            target_directory,
            service.paths.marker.data_set_id.clone(),
            record,
        )
    })
    .await
    .map_err(|_| {
        issue(
            IssueCode::Internal,
            "目录预检任务失败。",
            RecoveryAction::Retry,
        )
    })?
}

fn detect_legacy_paths() -> DesktopResult<Option<(PathBuf, Option<PathBuf>)>> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return Ok(None);
    };
    let source = local.join("Moon/models");
    let legacy_profile = local.join("local.moon.desktop");
    let exists = |path: &std::path::Path| {
        path.try_exists().map_err(|_| {
            issue(
                IssueCode::Permission,
                "无法读取旧版 Moon 数据目录。",
                RecoveryAction::Retry,
            )
        })
    };
    let has_profile = exists(&legacy_profile.join("EBWebView"))?;
    if !exists(&source)? && !has_profile {
        return Ok(None);
    }
    Ok(Some((source, has_profile.then_some(legacy_profile))))
}

#[tauri::command]
pub fn storage_detect_legacy_sources() -> DesktopResult<OptionalLegacySource> {
    Ok(
        detect_legacy_paths()?.map(|(source, profile)| StorageLegacySource {
            source_directory: storage::text(&source),
            legacy_profile_directory: profile.as_deref().map(storage::text),
        }),
    )
}

#[tauri::command]
pub async fn storage_prepare_import(
    app: AppHandle,
    input: ImportPrepareInput,
) -> DesktopResult<MigrationPlan> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<DesktopRuntime>();
        let _request = service
            .maintenance_requests
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let snapshot = service.snapshot();
        validate_migration_environment(&snapshot)?;
        let (normalized_target, target_directory) =
            normalize_new_target_directory(&input.target_directory)?;
        let id = uuid::Uuid::new_v4().to_string();
        let (source_path, legacy_profile, data_set_id) = if input.legacy {
            let (source, profile) = detect_legacy_paths()?.ok_or_else(|| {
                issue(
                    IssueCode::Validation,
                    "未在本机找到旧版 Moon 数据目录。",
                    RecoveryAction::None,
                )
            })?;
            (source, profile, uuid::Uuid::new_v4().to_string())
        } else {
            if input.source_directory.len() > 4096
                || !PathBuf::from(&input.source_directory).is_absolute()
            {
                return Err(issue(
                    IssueCode::Validation,
                    "请选择绝对路径的已有 Moon 数据目录。",
                    RecoveryAction::ChooseDirectory,
                ));
            }
            let requested_source = PathBuf::from(&input.source_directory);
            storage::reject_links(&requested_source).map_err(|message| {
                issue(
                    IssueCode::Validation,
                    message,
                    RecoveryAction::ChooseDirectory,
                )
            })?;
            if !requested_source.is_dir() {
                return Err(issue(
                    IssueCode::Validation,
                    "所选源数据目录不存在。",
                    RecoveryAction::ChooseDirectory,
                ));
            }
            let canonical_source = dunce::canonicalize(&requested_source).map_err(|_| {
                issue(
                    IssueCode::Validation,
                    "无法解析源数据目录。",
                    RecoveryAction::ChooseDirectory,
                )
            })?;
            if storage::text(&canonical_source)
                .eq_ignore_ascii_case(&storage::text(&service.paths.data))
            {
                return Err(issue(
                    IssueCode::Validation,
                    "所选目录正是当前正在使用的数据目录，请直接迁移或选择其他目录。",
                    RecoveryAction::ChooseDirectory,
                ));
            }
            let marker: DataMarker = serde_json::from_value(
                storage::read_json(&canonical_source.join("moon-data.json")).map_err(|_| {
                    issue(
                        IssueCode::Validation,
                        "所选目录不包含有效的 Moon 数据标记（moon-data.json）。",
                        RecoveryAction::ChooseDirectory,
                    )
                })?,
            )
            .map_err(|_| {
                issue(
                    IssueCode::Validation,
                    "所选目录的数据标记损坏。",
                    RecoveryAction::ChooseDirectory,
                )
            })?;
            if marker.schema_version != 1 || uuid::Uuid::parse_str(&marker.data_set_id).is_err() {
                return Err(issue(
                    IssueCode::Compatibility,
                    "所选目录的数据版本或身份不受支持。",
                    RecoveryAction::ChooseDirectory,
                ));
            }
            (canonical_source, None, marker.data_set_id)
        };
        let record = migration::import_record(
            &service.paths,
            &id,
            &source_path,
            &target_directory,
            &data_set_id,
            input.legacy,
            legacy_profile.as_deref(),
        );
        inspect_and_build_plan(
            &app,
            &service,
            id,
            storage::text(&source_path),
            normalized_target,
            target_directory,
            data_set_id,
            record,
        )
    })
    .await
    .map_err(|_| {
        issue(
            IssueCode::Internal,
            "导入预检任务失败。",
            RecoveryAction::Retry,
        )
    })?
}
#[tauri::command]
pub async fn storage_start_migration(
    app: AppHandle,
    input: MigrationStartInput,
) -> DesktopResult<MaintenanceState> {
    tauri::async_runtime::spawn_blocking(move || start_migration(app, input))
        .await
        .map_err(|_| {
            issue(
                IssueCode::Internal,
                "迁移启动结果未确认，请读取当前状态。",
                RecoveryAction::Retry,
            )
        })?
}
fn start_migration(app: AppHandle, input: MigrationStartInput) -> DesktopResult<MaintenanceState> {
    let service = app.state::<DesktopRuntime>();
    let _request = service
        .maintenance_requests
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let snapshot = service.snapshot();
    if snapshot.maintenance.writes_frozen
        && snapshot.maintenance.operation_id.as_deref() == Some(&input.plan_id)
    {
        return Ok(snapshot.maintenance);
    }
    let plan = service
        .plan
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
        .filter(|plan| plan.plan_id == input.plan_id)
        .ok_or_else(|| {
            issue(
                IssueCode::Validation,
                "迁移计划已失效，请重新选择目录。",
                RecoveryAction::ChooseDirectory,
            )
        })?;
    if plan.data_set_id != service.paths.marker.data_set_id
        || plan.generation != service.paths.bootstrap.generation
        || OffsetDateTime::parse(&plan.expires_at, &Rfc3339)
            .is_ok_and(|date| date < OffsetDateTime::now_utc())
    {
        return Err(issue(
            IssueCode::Validation,
            "源数据身份或预检计划已变化，请重新预检。",
            RecoveryAction::ChooseDirectory,
        ));
    }
    service.begin(
        &app,
        MaintenanceKind::Migration,
        plan.plan_id.clone(),
        Some(plan.source_directory.clone()),
        Some(plan.target_directory.clone()),
    )?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let service = handle.state::<DesktopRuntime>();
        let mut record =
            migration::migration_record(&service.paths, &plan.plan_id, &plan.target_directory);
        let result = (|| -> DesktopResult<()> {
            service.persist(&record)?;
            migration::worker(
                &service.paths,
                "--inspect",
                &migration::record_file(&service.paths, &plan.plan_id),
            )
            .map_err(migration_issue)?;
            service.prepare_shutdown(&handle, &mut record, input.stop_active)?;
            record["phase"] = json!("waitingForExit");
            service.persist(&record)?;
            migration::spawn_helper(&service.paths, &plan.plan_id)
                .map_err(|message| issue(IssueCode::Unknown, message, RecoveryAction::Restart))?;
            service.change(&handle, |state| {
                state.maintenance.phase = MaintenancePhase::WaitingForExit
            });
            handle.exit(0);
            Ok(())
        })();
        if let Err(error) = result {
            record["phase"] = json!("failed");
            record["message"] = json!(error.message);
            let _ = service.persist(&record);
            service.fail(&handle, error);
        }
    });
    Ok(service.snapshot().maintenance)
}
#[tauri::command]
pub fn desktop_acknowledge_flush(
    service: State<'_, DesktopRuntime>,
    input: FlushAcknowledgeInput,
) -> DesktopResult<()> {
    if input.blockers.len() > 100 || input.operation_id.len() > 128 || input.nonce.len() > 128 {
        return Err(issue(
            IssueCode::Validation,
            "保存确认参数无效。",
            RecoveryAction::None,
        ));
    }
    let guard = service.flush.lock().map_err(|_| {
        issue(
            IssueCode::Internal,
            "保存确认通道不可用。",
            RecoveryAction::Restart,
        )
    })?;
    let wait = guard
        .as_ref()
        .filter(|wait| wait.operation_id == input.operation_id && wait.nonce == input.nonce)
        .ok_or_else(|| {
            issue(
                IssueCode::Validation,
                "保存确认已过期，不会推进其他维护。",
                RecoveryAction::None,
            )
        })?;
    wait.sender.send(input).map_err(|_| {
        issue(
            IssueCode::Validation,
            "保存确认等待已结束。",
            RecoveryAction::None,
        )
    })
}
#[tauri::command]
pub fn desktop_acknowledge_startup(
    app: AppHandle,
    input: StartupAcknowledgeInput,
) -> DesktopResult<()> {
    let service = app.state::<DesktopRuntime>();
    service.acknowledge_startup(&app, input)?;
    crate::updater::schedule_background_checks(&app);
    Ok(())
}
#[tauri::command]
pub fn desktop_restart(app: AppHandle, service: State<'_, DesktopRuntime>) -> DesktopResult<()> {
    let state = service.snapshot().maintenance;
    if !state.shutdown_started
        || !matches!(
            state.phase,
            MaintenancePhase::Failed | MaintenancePhase::Unknown
        )
    {
        return Err(issue(
            IssueCode::Busy,
            "仅维护不可逆失败时允许使用恢复重启；正常会话请通过正常退出保存。",
            RecoveryAction::None,
        ));
    }
    app.restart()
}
#[tauri::command]
pub fn update_check(app: AppHandle) -> DesktopResult<UpdateState> {
    crate::updater::check_update(&app, false)
}
#[tauri::command]
pub fn update_download(app: AppHandle, input: ReleaseInput) -> DesktopResult<UpdateState> {
    crate::updater::download_update(&app, &input.release_id)
}
#[tauri::command]
pub fn update_cancel(app: AppHandle) -> DesktopResult<UpdateState> {
    crate::updater::cancel_update(&app)
}
#[tauri::command]
pub fn update_dismiss_error(app: AppHandle) -> DesktopResult<UpdateState> {
    crate::updater::dismiss_error(&app)
}
#[tauri::command]
pub fn update_acknowledge_updated(app: AppHandle) -> DesktopResult<()> {
    crate::updater::acknowledge_updated(&app)
}
#[tauri::command]
pub async fn update_set_preferences(
    app: AppHandle,
    input: UpdatePreferences,
) -> DesktopResult<UpdatePreferences> {
    tauri::async_runtime::spawn_blocking(move || save_update_preferences(app, input))
        .await
        .map_err(|_| {
            issue(
                IssueCode::Internal,
                "更新偏好保存结果未确认，请重新读取。",
                RecoveryAction::Retry,
            )
        })?
}
fn save_update_preferences(
    app: AppHandle,
    input: UpdatePreferences,
) -> DesktopResult<UpdatePreferences> {
    let service = app.state::<DesktopRuntime>();
    let _action = service
        .actions
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if service.snapshot().maintenance.writes_frozen {
        return Err(issue(
            IssueCode::Busy,
            "正在执行数据迁移，稍后保存更新设置。",
            RecoveryAction::Wait,
        ));
    }
    storage::atomic_json(&service.paths.data.join("updates/preferences.json"), &input)
        .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Retry))?;
    service.change(&app, |state| state.update_preferences = input.clone());
    Ok(input)
}
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    input: UpdateInstallInput,
) -> DesktopResult<UpdateState> {
    tauri::async_runtime::spawn_blocking(move || crate::updater::install_update(app, input))
        .await
        .map_err(|_| {
            issue(
                IssueCode::Internal,
                "更新安装未能启动，请重试。",
                RecoveryAction::Retry,
            )
        })?
}
