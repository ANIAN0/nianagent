use crate::{
    desktop_contract_generated::*,
    desktop_runtime::{DesktopResult, DesktopRuntime, FlushWait, issue, now},
    models::ModelBackend,
    storage::{self, StoragePaths},
};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const CHECK_INTERVAL_HOURS: i64 = 6;
const STARTUP_CHECK_DELAY_SECS: u64 = 10;
const RELEASE_REPO_OWNER: &str = "ANIAN0";
const RELEASE_REPO_NAME: &str = "nianagent";

static BACKGROUND_SCHEDULER_STARTED: AtomicBool = AtomicBool::new(false);

fn updates_dir(paths: &StoragePaths) -> PathBuf {
    paths.data.join("updates")
}

fn staged_dir(paths: &StoragePaths) -> PathBuf {
    updates_dir(paths).join("staged")
}

fn staged_meta_path(paths: &StoragePaths) -> PathBuf {
    staged_dir(paths).join("meta.json")
}

fn staged_payload_path(paths: &StoragePaths) -> PathBuf {
    staged_dir(paths).join("payload.bin")
}

fn pending_install_path(paths: &StoragePaths) -> PathBuf {
    updates_dir(paths).join("pending-install.json")
}

fn release_tag_url(version: &str) -> String {
    format!("https://github.com/{RELEASE_REPO_OWNER}/{RELEASE_REPO_NAME}/releases/tag/v{version}")
}

fn cleanup_staged(paths: &StoragePaths) {
    let dir = staged_dir(paths);
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

pub fn default_preferences() -> UpdatePreferences {
    UpdatePreferences {
        auto_check: true,
        auto_download: true,
    }
}

pub fn load_preferences(paths: &StoragePaths) -> UpdatePreferences {
    storage::read_json(&updates_dir(paths).join("preferences.json"))
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_else(default_preferences)
}

pub fn init_update_state(paths: &StoragePaths, unavailable_reason: Option<String>) -> UpdateState {
    let current_version = env!("CARGO_PKG_VERSION");
    let mut just_updated_from = None;

    let pending_path = pending_install_path(paths);
    if pending_path.exists() {
        if let Ok(record) = storage::read_json(&pending_path) {
            if record["toVersion"].as_str() == Some(current_version) {
                just_updated_from = record["fromVersion"].as_str().map(str::to_owned);
                cleanup_staged(paths);
            }
        }
        let _ = std::fs::remove_file(&pending_path);
    }

    // 清理过时或同版本的暂存安装包
    if let Ok(meta) = storage::read_json(&staged_meta_path(paths)) {
        let staged_version = meta["version"].as_str().unwrap_or_default();
        let newer = semver::Version::parse(staged_version)
            .ok()
            .zip(semver::Version::parse(current_version).ok())
            .is_some_and(|(staged, current)| staged > current);
        if !newer || !staged_payload_path(paths).exists() {
            cleanup_staged(paths);
        }
    }

    let checked_at = storage::read_json(&updates_dir(paths).join("check.json"))
        .ok()
        .and_then(|value| value["checkedAt"].as_str().map(str::to_owned));

    if let Some(reason) = unavailable_reason {
        return UpdateState {
            operation_id: None,
            revision: 0,
            phase: UpdatePhase::Unavailable,
            release: None,
            downloaded_bytes: 0,
            total_bytes: None,
            checked_at,
            error: Some(UpdateError {
                code: UpdateErrorCode::Unavailable,
                message: reason,
                detail: None,
                active_sessions: vec![],
            }),
            just_updated_from,
        };
    }

    UpdateState {
        operation_id: None,
        revision: 0,
        phase: UpdatePhase::Idle,
        release: None,
        downloaded_bytes: 0,
        total_bytes: None,
        checked_at,
        error: None,
        just_updated_from,
    }
}

fn load_verified_staged_bytes(
    paths: &StoragePaths,
    update: &tauri_plugin_updater::Update,
) -> Option<Vec<u8>> {
    let meta = storage::read_json(&staged_meta_path(paths)).ok()?;
    if meta["version"].as_str() != Some(update.version.as_str())
        || meta["signature"].as_str() != Some(update.signature.as_str())
    {
        return None;
    }
    let payload = std::fs::read(staged_payload_path(paths)).ok()?;
    if payload.is_empty() {
        cleanup_staged(paths);
        return None;
    }
    if let Err(error) = update.verify(&payload) {
        log::warn!("staged update verification failed, removing staged payload: {error}");
        cleanup_staged(paths);
        return None;
    }
    Some(payload)
}

fn save_staged_bytes(paths: &StoragePaths, version: &str, signature: &str, bytes: &[u8]) {
    let dir = staged_dir(paths);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let payload_path = staged_payload_path(paths);
    let temp_path = dir.join("payload.bin.tmp");
    if std::fs::write(&temp_path, bytes).is_ok() {
        let _ = std::fs::rename(&temp_path, &payload_path);
        let _ = storage::atomic_json(
            &staged_meta_path(paths),
            &json!({
                "version": version,
                "signature": signature,
                "savedAt": now(),
                "size": bytes.len(),
            }),
        );
    }
}

fn map_updater_error(error: tauri_plugin_updater::Error) -> UpdateError {
    use tauri_plugin_updater::Error::*;
    let detail = Some(error.to_string());
    match error {
        Minisign(_)
        | Base64(_)
        | SignatureUtf8(_)
        | SignedVersionMismatch { .. }
        | MissingSignedVersion => UpdateError {
            code: UpdateErrorCode::Signature,
            message: "更新包签名校验失败，已阻止安装。".into(),
            detail,
            active_sessions: vec![],
        },
        TargetNotFound(_) | TargetsNotFound(_) | UnsupportedArch | UnsupportedOs
        | Serialization(_) | Semver(_) => UpdateError {
            code: UpdateErrorCode::Compatibility,
            message: "发行清单与当前系统架构不兼容。".into(),
            detail,
            active_sessions: vec![],
        },
        _ => UpdateError {
            code: UpdateErrorCode::Offline,
            message: "无法连接更新服务，请检查网络后重试。".into(),
            detail,
            active_sessions: vec![],
        },
    }
}

pub fn check_update(app: &AppHandle, silent: bool) -> DesktopResult<UpdateState> {
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
                .unwrap_or_else(|| "当前环境不支持自动更新。".into()),
            RecoveryAction::None,
        ));
    }
    if matches!(
        snapshot.update.phase,
        UpdatePhase::Checking | UpdatePhase::Downloading | UpdatePhase::Installing
    ) {
        return Ok(snapshot.update);
    }
    if silent && matches!(snapshot.update.phase, UpdatePhase::Ready) {
        return Ok(snapshot.update);
    }
    if snapshot.maintenance.writes_frozen {
        return Err(issue(
            IssueCode::Busy,
            "正在执行数据迁移，请稍后再检查更新。",
            RecoveryAction::Wait,
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let checked_at = now();
    let _ = storage::atomic_json(
        &updates_dir(&service.paths).join("check.json"),
        &json!({ "checkedAt": checked_at }),
    );
    let previous_phase = snapshot.update.phase.clone();
    let previous_release = snapshot.update.release.clone();

    service.change(app, |state| {
        state.update.operation_id = Some(id.clone());
        state.update.phase = UpdatePhase::Checking;
        state.update.checked_at = Some(checked_at);
        state.update.error = None;
        if !silent {
            state.update.downloaded_bytes = 0;
            state.update.total_bytes = None;
        }
    });

    let handle = app.clone();
    let operation = id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let service = handle.state::<DesktopRuntime>();
        let before_exit = handle.clone();
        let result = match handle
            .updater_builder()
            .timeout(Duration::from_secs(30))
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
                let prefix = format!(
                    "/{RELEASE_REPO_OWNER}/{RELEASE_REPO_NAME}/releases/download/v{}/",
                    update.version
                );
                if update.download_url.scheme() != "https"
                    || update.download_url.host_str() != Some("github.com")
                    || !update.download_url.path().starts_with(&prefix)
                {
                    service.change_update(&handle, &operation, |state| {
                        state.update.phase = UpdatePhase::Error;
                        state.update.error = Some(UpdateError {
                            code: UpdateErrorCode::Compatibility,
                            message: "更新包来源校验未通过，已停止下载。".into(),
                            detail: Some(update.download_url.to_string()),
                            active_sessions: vec![],
                        });
                    });
                    return;
                }

                let release = UpdateRelease {
                    release_id: uuid::Uuid::new_v4().to_string(),
                    version: update.version.clone(),
                    notes: update.body.clone().unwrap_or_default(),
                    published_at: update.date.and_then(|date| date.format(&Rfc3339).ok()),
                    release_url: release_tag_url(&update.version),
                };

                let staged = load_verified_staged_bytes(&service.paths, &update);

                if !service.change_update(&handle, &operation, |state| {
                    *service
                        .update
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner()) = Some(update);
                    state.update.release = Some(release.clone());
                    state.update.error = None;
                    if let Some(bytes) = staged {
                        let size = bytes.len() as u64;
                        *service
                            .bytes
                            .lock()
                            .unwrap_or_else(|poison| poison.into_inner()) = Some(bytes);
                        state.update.phase = UpdatePhase::Ready;
                        state.update.downloaded_bytes = size;
                        state.update.total_bytes = Some(size);
                    } else {
                        state.update.phase = UpdatePhase::Available;
                        state.update.downloaded_bytes = 0;
                        state.update.total_bytes = None;
                    }
                }) {
                    return;
                }

                let current = service.snapshot();
                if matches!(current.update.phase, UpdatePhase::Available)
                    && current.update_preferences.auto_download
                {
                    let _ = download_update(&handle, &release.release_id);
                }
            }
            Ok(None) => {
                cleanup_staged(&service.paths);
                service
                    .bytes
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .take();
                service.change_update(&handle, &operation, |state| {
                    state.update.phase = UpdatePhase::UpToDate;
                    state.update.release = None;
                    state.update.error = None;
                    state.update.downloaded_bytes = 0;
                    state.update.total_bytes = None;
                });
            }
            Err(error) => {
                service.change_update(&handle, &operation, |state| {
                    if silent {
                        // 后台静默检查失败不打扰用户，恢复到之前的健康状态
                        state.update.phase = match previous_phase {
                            UpdatePhase::Available if previous_release.is_some() => {
                                UpdatePhase::Available
                            }
                            UpdatePhase::UpToDate => UpdatePhase::UpToDate,
                            _ => UpdatePhase::Idle,
                        };
                        state.update.error = None;
                    } else {
                        state.update.phase = UpdatePhase::Error;
                        state.update.error = Some(map_updater_error(error));
                    }
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
            "更新信息已过期，请重新检查更新。",
            RecoveryAction::Retry,
        ));
    }
    if matches!(
        snapshot.update.phase,
        UpdatePhase::Downloading | UpdatePhase::Ready | UpdatePhase::Installing
    ) {
        return Ok(snapshot.update);
    }
    if snapshot.maintenance.writes_frozen {
        return Err(issue(
            IssueCode::Busy,
            "正在执行数据迁移，请稍后下载。",
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
                "更新信息已失效，请重新检查更新。",
                RecoveryAction::Retry,
            )
        })?;

    // 若磁盘已有匹配且验签通过的暂存包，直接进入就绪状态
    if let Some(staged) = load_verified_staged_bytes(&service.paths, &update) {
        let size = staged.len() as u64;
        *service
            .bytes
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(staged);
        service.change(app, |state| {
            state.update.phase = UpdatePhase::Ready;
            state.update.downloaded_bytes = size;
            state.update.total_bytes = Some(size);
            state.update.error = None;
        });
        return Ok(service.snapshot().update);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let operation = id.clone();
    service.change(app, |state| {
        state.update.operation_id = Some(id.clone());
        state.update.phase = UpdatePhase::Downloading;
        state.update.downloaded_bytes = 0;
        state.update.total_bytes = None;
        state.update.error = None;
    });

    let handle = app.clone();
    let version = update.version.clone();
    let signature = update.signature.clone();
    let task = tauri::async_runtime::spawn(async move {
        let chunks = handle.clone();
        let chunks_id = operation.clone();
        let last_emit = std::sync::Mutex::new(Instant::now() - Duration::from_secs(1));
        let downloaded = std::sync::atomic::AtomicU64::new(0);

        let result = update
            .download(
                move |chunk_len, total| {
                    let next = downloaded.fetch_add(chunk_len as u64, Ordering::Relaxed)
                        + chunk_len as u64;
                    let mut guard = last_emit
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner());
                    let reached_end = total.is_some_and(|t| next >= t);
                    if guard.elapsed() >= Duration::from_millis(120) || reached_end {
                        *guard = Instant::now();
                        drop(guard);
                        let service = chunks.state::<DesktopRuntime>();
                        service.change_update(&chunks, &chunks_id, |state| {
                            state.update.downloaded_bytes = next;
                            state.update.total_bytes = total;
                        });
                    }
                },
                || {},
            )
            .await;

        let service = handle.state::<DesktopRuntime>();
        if service.snapshot().update.operation_id.as_deref() != Some(&operation) {
            return;
        }

        match result {
            Ok(bytes) => {
                let size = bytes.len() as u64;
                save_staged_bytes(&service.paths, &version, &signature, &bytes);
                service.change_update(&handle, &operation, |state| {
                    *service
                        .bytes
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner()) = Some(bytes);
                    state.update.phase = UpdatePhase::Ready;
                    state.update.downloaded_bytes = size;
                    state.update.total_bytes = Some(size);
                    state.update.error = None;
                });
            }
            Err(error) => {
                service.change_update(&handle, &operation, |state| {
                    state.update.phase = UpdatePhase::Error;
                    state.update.error = Some(map_updater_error(error));
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

pub fn cancel_update(app: &AppHandle) -> DesktopResult<UpdateState> {
    let service = app.state::<DesktopRuntime>();
    let _action = service
        .actions
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let snapshot = service.snapshot();
    if !matches!(
        snapshot.update.phase,
        UpdatePhase::Checking | UpdatePhase::Downloading
    ) {
        return Ok(snapshot.update);
    }

    if let Some((_, task)) = service
        .network
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take()
    {
        task.abort();
    }

    service.change(app, |state| {
        state.update.operation_id = None;
        state.update.error = None;
        state.update.downloaded_bytes = 0;
        state.update.total_bytes = None;
        state.update.phase = if state.update.release.is_some() {
            UpdatePhase::Available
        } else {
            UpdatePhase::Idle
        };
    });

    Ok(service.snapshot().update)
}

pub fn dismiss_error(app: &AppHandle) -> DesktopResult<UpdateState> {
    let service = app.state::<DesktopRuntime>();
    let _action = service
        .actions
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let has_bytes = service
        .bytes
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .is_some();

    service.change(app, |state| {
        if matches!(state.update.phase, UpdatePhase::Error) {
            state.update.error = None;
            state.update.phase = if has_bytes && state.update.release.is_some() {
                UpdatePhase::Ready
            } else if state.update.release.is_some() {
                UpdatePhase::Available
            } else {
                UpdatePhase::Idle
            };
        }
    });
    Ok(service.snapshot().update)
}

pub fn acknowledge_updated(app: &AppHandle) -> DesktopResult<()> {
    let service = app.state::<DesktopRuntime>();
    service.change(app, |state| {
        state.update.just_updated_from = None;
    });
    Ok(())
}

pub fn install_update(app: AppHandle, input: UpdateInstallInput) -> DesktopResult<UpdateState> {
    let service = app.state::<DesktopRuntime>();
    let _action = service
        .actions
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let snapshot = service.snapshot();

    if matches!(snapshot.update.phase, UpdatePhase::Installing) {
        return Ok(snapshot.update);
    }
    if !snapshot.capabilities.install_updates {
        return Err(issue(
            IssueCode::Unavailable,
            "当前为开发模式或未配置签名公钥，无法安装正式更新。",
            RecoveryAction::None,
        ));
    }
    if snapshot.maintenance.writes_frozen {
        return Err(issue(
            IssueCode::Busy,
            "正在执行数据迁移，请等待完成后再更新。",
            RecoveryAction::Wait,
        ));
    }

    let release = snapshot
        .update
        .release
        .clone()
        .filter(|release| release.release_id == input.release_id)
        .ok_or_else(|| {
            issue(
                IssueCode::Validation,
                "更新信息已过期，请重新检查更新。",
                RecoveryAction::Retry,
            )
        })?;

    let update = service
        .update
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
        .ok_or_else(|| {
            issue(
                IssueCode::Validation,
                "更新信息已失效，请重新检查更新。",
                RecoveryAction::Retry,
            )
        })?;

    // 优先使用内存中的已校验字节，否则从本地暂存恢复（绝不因一次失败而丢失已下载包）
    let bytes = {
        let guard = service
            .bytes
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        guard.clone()
    }
    .or_else(|| load_verified_staged_bytes(&service.paths, &update))
    .ok_or_else(|| {
        issue(
            IssueCode::Validation,
            "更新包尚未就绪或已损坏，请重新下载。",
            RecoveryAction::Retry,
        )
    })?;

    // 在关闭任何后端会话前先做一次完整性与签名核验，损坏则清理暂存并保留当前会话
    if let Err(error) = update.verify(&bytes) {
        log::warn!("update payload verification failed before shutdown: {error}");
        service
            .bytes
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take();
        cleanup_staged(&service.paths);
        service.change(&app, |state| {
            state.update.phase = UpdatePhase::Error;
            state.update.downloaded_bytes = 0;
            state.update.total_bytes = None;
            state.update.error = Some(map_updater_error(error));
        });
        return Ok(service.snapshot().update);
    }

    let operation_id = uuid::Uuid::new_v4().to_string();
    let backend = app.state::<ModelBackend>();

    // 1. 普通更新先只读检查活跃会话（不关闭后端），有问题直接暂停并返回原工作区
    if !input.force_stop {
        match backend.internal(
            "$maintenance",
            json!({
                "action": "inspect",
                "operationId": operation_id,
            }),
            Duration::from_secs(5),
        ) {
            Ok(value) if value["closed"] == true => {
                service.change(&app, |state| {
                    state.update.phase = UpdatePhase::Error;
                    state.update.error = Some(UpdateError {
                        code: UpdateErrorCode::ActiveSessions,
                        message:
                            "后台服务已进入关闭状态，请重启应用后再继续工作，或选择仍然重启更新。"
                                .into(),
                        detail: None,
                        active_sessions: vec![],
                    });
                });
                return Ok(service.snapshot().update);
            }
            Ok(value) => {
                let active_sessions: Vec<UpdateActiveSession> = value["activities"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|activity| {
                        matches!(
                            activity["kind"].as_str(),
                            Some("conversation" | "authorization")
                        )
                    })
                    .map(|activity| UpdateActiveSession {
                        id: activity["sessionId"]
                            .as_str()
                            .or_else(|| activity["id"].as_str())
                            .unwrap_or_default()
                            .to_string(),
                        title: activity["label"]
                            .as_str()
                            .unwrap_or("运行中的会话")
                            .to_string(),
                    })
                    .collect();
                if !active_sessions.is_empty() {
                    service.change(&app, |state| {
                        state.update.phase = UpdatePhase::Error;
                        state.update.error = Some(UpdateError {
                            code: UpdateErrorCode::ActiveSessions,
                            message: "当前有会话正在运行，停止后即可重启更新。".into(),
                            detail: None,
                            active_sessions,
                        });
                    });
                    return Ok(service.snapshot().update);
                }
            }
            Err(error) => {
                log::warn!("update backend inspect failed before flush: {error}");
                service.change(&app, |state| {
                    state.update.phase = UpdatePhase::Error;
                    state.update.error = Some(UpdateError {
                        code: UpdateErrorCode::ActiveSessions,
                        message: "无法确认当前会话是否已安全结束，已暂停更新以保护正在进行的工作。你可以稍后重试，或选择仍然重启更新。".into(),
                        detail: Some(error),
                        active_sessions: vec![],
                    });
                });
                return Ok(service.snapshot().update);
            }
        }
    }

    // 2. 在后端仍可用时请求前端保存草稿（非强制模式下未确认保存则中止，后端保持在线且前端解冻）
    let nonce = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = mpsc::channel();
    *service
        .flush
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some(FlushWait {
        operation_id: operation_id.clone(),
        nonce: nonce.clone(),
        sender,
    });
    let flush_result = match app.emit(
        "moon://maintenance-flush",
        FlushRequest {
            operation_id: operation_id.clone(),
            nonce,
            reason: FlushReason::Update,
            timeout_milliseconds: 3_000,
        },
    ) {
        Ok(()) => match receiver.recv_timeout(Duration::from_secs(3)) {
            Ok(ack) if ack.saved && ack.blockers.is_empty() => Ok(()),
            Ok(ack) => Err(if ack.blockers.is_empty() {
                "前端未能确认草稿保存完成。".to_string()
            } else {
                ack.blockers
                    .into_iter()
                    .map(|item| item.label)
                    .collect::<Vec<_>>()
                    .join("；")
            }),
            Err(_) => Err("等待前端保存草稿超时（3 秒）。".to_string()),
        },
        Err(error) => Err(format!("无法通知前端保存草稿：{error}")),
    };
    service
        .flush
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take();

    if let Err(detail) = flush_result {
        if !input.force_stop {
            log::warn!("update frontend flush did not confirm before shutdown: {detail}");
            service.change(&app, |state| {
                state.update.phase = UpdatePhase::Error;
                state.update.error = Some(UpdateError {
                    code: UpdateErrorCode::ActiveSessions,
                    message: "未能确认前端草稿已保存，已暂停更新以保护当前内容。你可以稍后重试，或选择仍然重启更新。".into(),
                    detail: Some(detail),
                    active_sessions: vec![],
                });
            });
            return Ok(service.snapshot().update);
        }
        log::warn!("update frontend flush skipped during forced shutdown: {detail}");
    }

    // 3. 草稿保存确认后，再由后端做最终活跃会话复核并执行轻量级排空关闭
    let drain_result = backend.internal(
        "$maintenance",
        json!({
            "action": "prepareUpdateShutdown",
            "operationId": operation_id,
            "stopActive": input.force_stop,
        }),
        Duration::from_secs(15),
    );

    match drain_result {
        Ok(value) if value["ready"] == false => {
            let active_sessions: Vec<UpdateActiveSession> =
                serde_json::from_value(value["activeSessions"].clone()).unwrap_or_default();
            service.change(&app, |state| {
                state.update.phase = UpdatePhase::Error;
                state.update.error = Some(UpdateError {
                    code: UpdateErrorCode::ActiveSessions,
                    message: "当前有会话正在运行，停止后即可重启更新。".into(),
                    detail: None,
                    active_sessions,
                });
            });
            return Ok(service.snapshot().update);
        }
        Ok(_) => {}
        Err(error) if !input.force_stop => {
            log::warn!("update backend drain failed during final shutdown: {error}");
            service.change(&app, |state| {
                state.update.phase = UpdatePhase::Error;
                state.update.error = Some(UpdateError {
                    code: UpdateErrorCode::ActiveSessions,
                    message:
                        "未能确认后台服务是否已关闭。后台可能仍在退出，请重启 Moon 后再继续工作。"
                            .into(),
                    detail: Some(error),
                    active_sessions: vec![],
                });
            });
            return Ok(service.snapshot().update);
        }
        Err(error) => {
            log::warn!("update backend drain returned error during forced shutdown: {error}");
        }
    }

    service.change(&app, |state| {
        state.update.phase = UpdatePhase::Installing;
        state.update.error = None;
    });

    // 3. 确保 Node 后端及子进程完全退出，释放所有文件锁（避免 Windows NSIS 覆盖失败）
    backend.shutdown();

    // 4. 写入待确认升级记录，供新版本启动后弹出一次成功提示
    let _ = storage::atomic_json(
        &pending_install_path(&service.paths),
        &json!({
            "fromVersion": env!("CARGO_PKG_VERSION"),
            "toVersion": release.version,
            "startedAt": now(),
        }),
    );

    // 5. 交由 Tauri + NSIS 安装程序覆盖安装并重启
    if let Err(error) = update.install(bytes) {
        let _ = std::fs::remove_file(pending_install_path(&service.paths));
        service.change(&app, |state| {
            state.update.phase = UpdatePhase::Error;
            state.update.error = Some(UpdateError {
                code: UpdateErrorCode::InstallFailed,
                message: "安装程序未能启动，请重试或在浏览器中手动下载安装包。".into(),
                detail: Some(error.to_string()),
                active_sessions: vec![],
            });
        });
        return Ok(service.snapshot().update);
    }

    Ok(service.snapshot().update)
}

fn is_check_due(checked_at: Option<&str>) -> bool {
    checked_at
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
        .is_none_or(|date| {
            OffsetDateTime::now_utc() - date >= time::Duration::hours(CHECK_INTERVAL_HOURS)
        })
}

pub fn schedule_background_checks(app: &AppHandle) {
    if BACKGROUND_SCHEDULER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        // 启动稳定 10 秒后再做首次静默检查，避免与启动抢占资源
        std::thread::sleep(Duration::from_secs(STARTUP_CHECK_DELAY_SECS));
        loop {
            if let Some(service) = handle.try_state::<DesktopRuntime>() {
                let snapshot = service.snapshot();
                if snapshot.update_preferences.auto_check
                    && snapshot.capabilities.check_updates
                    && !snapshot.maintenance.writes_frozen
                    && is_check_due(snapshot.update.checked_at.as_deref())
                {
                    let _ = check_update(&handle, true);
                }
            }
            std::thread::sleep(Duration::from_secs((CHECK_INTERVAL_HOURS * 3600) as u64));
        }
    });
}
