use crate::{
    desktop_contract_generated::*,
    desktop_runtime::{self, DesktopResult, DesktopRuntime, issue},
    migration,
    models::ModelBackend,
    storage,
};
use serde_json::json;
use std::{path::PathBuf, process::Command, time::Duration};
use tauri::{AppHandle, Manager, State};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[tauri::command]
pub fn desktop_get_state(service: State<'_, DesktopRuntime>) -> DesktopSnapshot {
    service.snapshot()
}
fn open_directory(path: &str) -> DesktopResult<()> {
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
        if !snapshot.capabilities.migrate_data {
            return Err(issue(
                IssueCode::Unavailable,
                "当前开发环境指定了数据根，请修改启动环境后重启；此模式不能在设置迁移。",
                RecoveryAction::None,
            ));
        }
        if snapshot.maintenance.writes_frozen
            || matches!(
                snapshot.update.phase,
                UpdatePhase::Downloading | UpdatePhase::Verifying | UpdatePhase::Preparing
            )
        {
            return Err(issue(
                IssueCode::Busy,
                "另一项维护正在进行。",
                RecoveryAction::Wait,
            ));
        }
        if input.target_directory.len() > 4096
            || !PathBuf::from(&input.target_directory).is_absolute()
        {
            return Err(issue(
                IssueCode::Validation,
                "请选择绝对路径的新专用空目录。",
                RecoveryAction::ChooseDirectory,
            ));
        }
        let requested = PathBuf::from(&input.target_directory);
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
        let target_directory = storage::text(&normalized);
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
        let file = migration::record_file(&service.paths, &id);
        storage::atomic_json(&file, &record)
            .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Retry))?;
        let inspected =
            migration::worker(&service.paths, "--inspect", &file).map_err(|message| {
                issue(
                    IssueCode::Validation,
                    message,
                    RecoveryAction::ChooseDirectory,
                )
            })?;
        storage::private_directory(&normalized, true).map_err(|message| {
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
            source_directory: storage::text(&service.paths.data),
            target_directory,
            data_set_id: service.paths.marker.data_set_id.clone(),
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
#[tauri::command]
pub fn storage_start_migration(
    app: AppHandle,
    input: MigrationStartInput,
) -> DesktopResult<MaintenanceState> {
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
            .map_err(|message| {
                issue(
                    IssueCode::Validation,
                    message,
                    RecoveryAction::ChooseDirectory,
                )
            })?;
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
    desktop_runtime::automatic_check(&app);
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
    desktop_runtime::check_update(&app)
}
#[tauri::command]
pub fn update_download(app: AppHandle, input: ReleaseInput) -> DesktopResult<UpdateState> {
    desktop_runtime::download_update(&app, &input.release_id)
}
#[tauri::command]
pub fn update_cancel(app: AppHandle, input: CancelInput) -> DesktopResult<UpdateState> {
    let service = app.state::<DesktopRuntime>();
    let _action = service
        .actions
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let snapshot = service.snapshot();
    if snapshot.update.operation_id.as_deref() != Some(&input.operation_id)
        || !matches!(
            snapshot.update.phase,
            UpdatePhase::Checking | UpdatePhase::Downloading | UpdatePhase::Verifying
        )
    {
        return Err(issue(
            IssueCode::Busy,
            "当前阶段不能取消，请读取最新状态。",
            RecoveryAction::None,
        ));
    }
    service.change(&app, |state| {
        state.update.operation_id = None;
        state.update.phase = if state.update.release.is_some() {
            UpdatePhase::Available
        } else {
            UpdatePhase::Idle
        };
        state.update.issue = Some(issue(
            IssueCode::Cancelled,
            "检查或下载已取消，重试会重新下载。",
            RecoveryAction::Retry,
        ));
    });
    if let Some((_, task)) = service
        .network
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take()
    {
        task.abort();
    }
    service
        .bytes
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take();
    Ok(service.snapshot().update)
}
#[tauri::command]
pub fn update_set_preferences(
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
            "正在维护，稍后保存更新设置。",
            RecoveryAction::Wait,
        ));
    }
    storage::atomic_json(&service.paths.data.join("updates/preferences.json"), &input)
        .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Retry))?;
    service.change(&app, |state| state.update_preferences = input.clone());
    Ok(input)
}
#[tauri::command]
pub fn update_install(
    app: AppHandle,
    input: UpdateInstallInput,
) -> DesktopResult<MaintenanceState> {
    let service = app.state::<DesktopRuntime>();
    let _request = service
        .maintenance_requests
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let snapshot = service.snapshot();
    if snapshot.maintenance.writes_frozen
        && matches!(snapshot.maintenance.kind, MaintenanceKind::Update)
        && snapshot
            .update
            .release
            .as_ref()
            .is_some_and(|release| release.release_id == input.release_id)
    {
        return Ok(snapshot.maintenance);
    }
    if !snapshot.capabilities.install_updates {
        return Err(issue(
            IssueCode::Unavailable,
            "开发模式或未配置发行公钥，不能安装正式更新。",
            RecoveryAction::None,
        ));
    }
    if snapshot
        .update
        .release
        .as_ref()
        .map(|release| release.release_id.as_str())
        != Some(&input.release_id)
        || !matches!(snapshot.update.phase, UpdatePhase::Ready)
    {
        return Err(issue(
            IssueCode::Validation,
            "当前版本尚未完成下载与签名校验。",
            RecoveryAction::Retry,
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let release = snapshot.update.release.unwrap();
    service.begin(
        &app,
        MaintenanceKind::Update,
        id.clone(),
        Some(storage::text(&service.paths.data)),
        None,
    )?;
    service.change(&app, |state| state.update.phase = UpdatePhase::Preparing);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let service = handle.state::<DesktopRuntime>();
        let mut record = json!({"operationId":id,"kind":"update","sourceDirectory":storage::text(&service.paths.data),"dataSetId":service.paths.marker.data_set_id,"generation":service.paths.bootstrap.generation,"oldVersion":env!("CARGO_PKG_VERSION"),"targetVersion":release.version,"releaseId":release.release_id,"shutdownStarted":false,"phase":"preparing","committed":false});
        let result = (|| -> DesktopResult<()> {
            service.persist(&record)?;
            storage::private_directory(&service.paths.control, false)
                .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Retry))?;
            storage::private_directory(&service.paths.data, false)
                .map_err(|message| issue(IssueCode::Permission, message, RecoveryAction::Retry))?;
            service.prepare_shutdown(&handle, &mut record, input.stop_active)?;
            let update = service
                .update
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .clone()
                .ok_or_else(|| {
                    issue(
                        IssueCode::Unknown,
                        "更新元数据已失效，请重启恢复。",
                        RecoveryAction::Restart,
                    )
                })?;
            let bytes = service
                .bytes
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .take()
                .ok_or_else(|| {
                    issue(
                        IssueCode::Unknown,
                        "更新字节已失效，请重启后重新下载。",
                        RecoveryAction::Restart,
                    )
                })?;
            record["phase"] = json!("handedOff");
            service.persist(&record)?;
            service.change(&handle, |state| {
                state.maintenance.phase = MaintenancePhase::HandedOff;
                state.update.phase = UpdatePhase::HandedOff;
            });
            // 此前已经严格drain并确认Node真实退出；on_before_exit只是同步最后保障。
            update.install(bytes).map_err(|_| {
                issue(
                    IssueCode::Unknown,
                    "安装准备或启动未完成，请重新启动Moon恢复服务并核对版本；不会自动重试安装。",
                    RecoveryAction::Restart,
                )
            })?;
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
