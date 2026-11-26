//! 正常启动的真实阶段投影；受管服务先存在，Node只能在实际profile核验后启用。
use crate::{
    desktop_contract_generated::*,
    desktop_runtime::{self, DesktopResult, DesktopRuntime, issue},
    diagnostics,
    models::ModelBackend,
    profile, storage,
};
use serde_json::json;
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

struct Inner {
    snapshot: BootSnapshot,
    host_ready: bool,
    profile_ready: bool,
    started_at: Instant,
}
pub struct BootRuntime {
    paths: storage::StoragePaths,
    inner: Mutex<Inner>,
    actions: Mutex<()>,
    terminating: AtomicBool,
}
impl BootRuntime {
    pub fn new(paths: storage::StoragePaths) -> Arc<Self> {
        Arc::new(Self {
            paths,
            inner: Mutex::new(Inner {
                snapshot: BootSnapshot {
                    attempt_id: uuid::Uuid::new_v4().to_string(),
                    revision: 1,
                    host_mode: BootHostMode::Desktop,
                    phase: BootPhase::Starting,
                    stage: BootStage::Profile,
                    storage: None,
                    issue: None,
                    capabilities: BootCapabilities {
                        retry: false,
                        exit: true,
                    },
                },
                host_ready: false,
                profile_ready: false,
                started_at: Instant::now(),
            }),
            actions: Mutex::new(()),
            terminating: AtomicBool::new(false),
        })
    }
    pub fn snapshot(&self) -> BootSnapshot {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .snapshot
            .clone()
    }
    pub fn ready(&self) -> bool {
        !self.terminating.load(Ordering::SeqCst)
            && matches!(self.snapshot().phase, BootPhase::Ready)
    }
    pub fn terminate(&self) {
        self.terminating.store(true, Ordering::SeqCst);
    }
    fn current(&self, attempt: &str) -> bool {
        !self.terminating.load(Ordering::SeqCst) && self.snapshot().attempt_id == attempt
    }
    fn change(
        &self,
        app: &AppHandle,
        attempt: &str,
        update: impl FnOnce(&mut Inner),
    ) -> Option<BootSnapshot> {
        let snapshot = {
            let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            if self.terminating.load(Ordering::SeqCst) || inner.snapshot.attempt_id != attempt {
                return None;
            }
            update(&mut inner);
            inner.snapshot.revision += 1;
            inner.snapshot.clone()
        };
        let _ = app.emit("moon://boot-state", &snapshot);
        Some(snapshot)
    }
    fn fail(&self, app: &AppHandle, attempt: &str, stage: BootStage, code: IssueCode, retry: bool) {
        log::warn!(
            "Moon启动失败：阶段 {:?}，错误 {:?}，当前阶段可重试 {}",
            stage,
            code,
            retry
        );
        let message = match stage {
            BootStage::Profile => {
                "无法核验Moon的实际界面数据目录。请检查WebView2与目录权限后重试。"
            }
            BootStage::Backend => "Moon桌面服务未能启动。请检查运行资源、占用或目录权限后重试。",
            BootStage::Storage => {
                "Moon无法读取或确认已保存的数据。原文件保留，请检查数据内容与目录权限后重试。"
            }
            BootStage::FrontendProfile => {
                "Moon的界面设置或可编辑草稿未能恢复。原恢复记录保留，请重试。"
            }
            BootStage::Workbench => "Moon工作台资源未能加载或启动确认未能保存，请重试。",
            BootStage::Ready => "Moon启动确认未完成，请重试。",
        };
        // 只记录宿主事实和固定错误映射；不公开第三方异常、配置内容或凭据。
        let diagnostics = format!(
            "Moon {}\n启动阶段: {:?}\n尝试: {}\n错误: {:?}\n当前阶段可重试: {}",
            env!("CARGO_PKG_VERSION"),
            stage,
            attempt,
            code,
            retry
        );
        self.change(app, attempt, |inner| {
            inner.snapshot.phase = BootPhase::Failed;
            inner.snapshot.stage = stage.clone();
            inner.snapshot.capabilities.retry = retry;
            inner.snapshot.capabilities.exit = true;
            inner.snapshot.issue = Some(BootIssue {
                code,
                stage,
                message: message.into(),
                diagnostics,
            });
        });
    }
    pub fn start(self: &Arc<Self>, app: &AppHandle) {
        let service = self.clone();
        let app = app.clone();
        let attempt = self.snapshot().attempt_id;
        tauri::async_runtime::spawn_blocking(move || service.run_host(&app, &attempt));
    }
    fn run_host(&self, app: &AppHandle, attempt: &str) {
        if !self.current(attempt) {
            return;
        }
        let host_started = Instant::now();
        let backend = app.state::<ModelBackend>();
        let result = (|| -> Result<(), BootStage> {
            let step_started = Instant::now();
            profile::verify(app, &self.paths).map_err(|_| BootStage::Profile)?;
            diagnostics::log_step(
                "boot.profile_verify",
                attempt,
                step_started.elapsed().as_millis(),
                "committed",
                "",
                "",
            );
            if !self.current(attempt) {
                return Err(BootStage::Profile);
            }
            self.change(app, attempt, |inner| {
                inner.snapshot.stage = BootStage::Backend
            });
            let step_started = Instant::now();
            backend.start().map_err(|_| BootStage::Backend)?;
            diagnostics::log_step(
                "boot.backend_start",
                attempt,
                step_started.elapsed().as_millis(),
                "committed",
                "",
                "",
            );
            if !self.current(attempt) {
                return Err(BootStage::Backend);
            }
            self.change(app, attempt, |inner| {
                inner.snapshot.stage = BootStage::Storage
            });
            let step_started = Instant::now();
            let readable = backend
                .internal("$validateStorage", json!({}), Duration::from_secs(60))
                .is_ok_and(|value| value["readable"] == true);
            if !readable {
                return Err(BootStage::Storage);
            }
            diagnostics::log_step(
                "boot.validate_storage",
                attempt,
                step_started.elapsed().as_millis(),
                "committed",
                "",
                "",
            );
            if !self.current(attempt) {
                return Err(BootStage::Storage);
            }
            storage::atomic_json(&self.paths.data.join("maintenance/startup.json"), &json!({
                "dataSetId":self.paths.marker.data_set_id,"generation":self.paths.bootstrap.generation,
                "version":env!("CARGO_PKG_VERSION"),"profileVerified":cfg!(windows),
                "profileDirectory":storage::text(&self.paths.data.join("webview")),
                "backendReadable":true,"frontendReady":false
            })).map_err(|_| BootStage::Storage)?;
            Ok(())
        })();
        if let Err(stage) = result {
            diagnostics::log_step(
                "boot.host_failed",
                attempt,
                host_started.elapsed().as_millis(),
                "unknown",
                &format!("boot_{stage:?}").to_lowercase(),
                "宿主启动阶段未能完成。",
            );
            let stopped = backend.shutdown_confirmed().is_ok();
            if !self.current(attempt) {
                return;
            }
            let _ = storage::atomic_json(
                &self.paths.data.join("maintenance/startup.json"),
                &json!({
                    "dataSetId":self.paths.marker.data_set_id,"generation":self.paths.bootstrap.generation,
                    "version":env!("CARGO_PKG_VERSION"),"profileVerified":false,"backendReadable":false,"frontendReady":false
                }),
            );
            desktop_runtime::record_startup_failure(&self.paths);
            self.fail(
                app,
                attempt,
                stage,
                if stopped {
                    IssueCode::Unavailable
                } else {
                    IssueCode::Unknown
                },
                stopped,
            );
            return;
        }
        if !self.current(attempt) {
            let _ = backend.shutdown_confirmed();
            return;
        }
        if app.try_state::<DesktopRuntime>().is_none() {
            app.manage(DesktopRuntime::new(self.paths.clone(), true));
        }
        diagnostics::log_step(
            "boot.host_ready",
            attempt,
            host_started.elapsed().as_millis(),
            "committed",
            "",
            "",
        );
        self.change(app, attempt, |inner| {
            inner.host_ready = true;
            inner.snapshot.storage = Some(self.paths.info());
            inner.snapshot.phase = BootPhase::WaitingFrontend;
            inner.snapshot.stage = BootStage::FrontendProfile;
            inner.snapshot.issue = None;
        });
    }
    pub fn retry(
        self: &Arc<Self>,
        app: &AppHandle,
        input: BootAttemptInput,
    ) -> DesktopResult<BootSnapshot> {
        let _action = self.actions.lock().unwrap_or_else(|p| p.into_inner());
        let current = self.snapshot();
        if self.terminating.load(Ordering::SeqCst)
            || current.attempt_id != input.attempt_id
            || !current.capabilities.retry
            || !matches!(current.phase, BootPhase::Failed)
        {
            return Err(issue(
                IssueCode::Busy,
                "当前启动尝试不能重试，请读取最新状态。",
                RecoveryAction::None,
            ));
        }
        let host_ready = self
            .inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .host_ready;
        // host失败的重试再次核实旧child确已退出，不借清空界面制造第二个Node。
        if !host_ready && app.state::<ModelBackend>().shutdown_confirmed().is_err() {
            self.fail(
                app,
                &current.attempt_id,
                current.stage,
                IssueCode::Unknown,
                false,
            );
            return Ok(self.snapshot());
        }
        let next = self
            .change(app, &current.attempt_id, |inner| {
                inner.snapshot.attempt_id = uuid::Uuid::new_v4().to_string();
                inner.snapshot.phase = if host_ready {
                    BootPhase::WaitingFrontend
                } else {
                    BootPhase::Starting
                };
                inner.snapshot.stage = if host_ready {
                    BootStage::FrontendProfile
                } else {
                    BootStage::Profile
                };
                inner.snapshot.issue = None;
                inner.snapshot.capabilities.retry = false;
                inner.profile_ready = false;
                inner.started_at = Instant::now();
            })
            .ok_or_else(|| {
                issue(
                    IssueCode::Unavailable,
                    "Moon正在退出。",
                    RecoveryAction::None,
                )
            })?;
        if !host_ready {
            self.start(app);
        }
        Ok(next)
    }
    pub fn acknowledge(
        &self,
        app: &AppHandle,
        input: BootFrontendInput,
    ) -> DesktopResult<BootSnapshot> {
        let _action = self.actions.lock().unwrap_or_else(|p| p.into_inner());
        let snapshot = self.snapshot();
        if !self.current(&input.attempt_id)
            || input.data_set_id != self.paths.marker.data_set_id
            || input.generation != self.paths.bootstrap.generation
        {
            return Err(issue(
                IssueCode::Validation,
                "启动尝试或数据身份已变化，请读取当前状态。",
                RecoveryAction::None,
            ));
        }
        if matches!(snapshot.phase, BootPhase::Ready) && input.ready {
            return Ok(snapshot);
        }
        // 页面重载并不重启已验证的Node；新页面真实profile/模块失败仍须进入可重试且可退出的启动页。
        if matches!(snapshot.phase, BootPhase::Ready) && !input.ready {
            let stage = if matches!(input.stage, BootFrontendStage::Profile) {
                BootStage::FrontendProfile
            } else {
                BootStage::Workbench
            };
            self.fail(app, &input.attempt_id, stage, IssueCode::Unavailable, true);
            return Ok(self.snapshot());
        }
        if !matches!(snapshot.phase, BootPhase::WaitingFrontend) {
            return Err(issue(
                IssueCode::Busy,
                "当前启动阶段不能确认前端就绪。",
                RecoveryAction::Wait,
            ));
        }
        match input.stage {
            BootFrontendStage::Profile => {
                if !matches!(
                    snapshot.stage,
                    BootStage::FrontendProfile | BootStage::Workbench
                ) {
                    return Err(issue(
                        IssueCode::Validation,
                        "profile确认顺序无效。",
                        RecoveryAction::None,
                    ));
                }
                if !input.ready {
                    self.fail(
                        app,
                        &input.attempt_id,
                        BootStage::FrontendProfile,
                        IssueCode::Validation,
                        true,
                    );
                } else {
                    let elapsed = self
                        .inner
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .started_at
                        .elapsed()
                        .as_millis();
                    diagnostics::log_step(
                        "boot.frontend_profile",
                        &input.attempt_id,
                        elapsed,
                        "committed",
                        "",
                        "",
                    );
                    self.change(app, &input.attempt_id, |inner| {
                        inner.profile_ready = true;
                        inner.snapshot.stage = BootStage::Workbench;
                    });
                }
            }
            BootFrontendStage::Workbench => {
                if !self
                    .inner
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .profile_ready
                    || !matches!(snapshot.stage, BootStage::Workbench)
                {
                    return Err(issue(
                        IssueCode::Validation,
                        "必须先完成界面profile恢复。",
                        RecoveryAction::None,
                    ));
                }
                if !input.ready {
                    self.fail(
                        app,
                        &input.attempt_id,
                        BootStage::Workbench,
                        IssueCode::Unavailable,
                        true,
                    );
                } else {
                    let confirmed = app.state::<DesktopRuntime>().acknowledge_startup(
                        app,
                        StartupAcknowledgeInput {
                            data_set_id: input.data_set_id,
                            generation: input.generation,
                            profile_ready: true,
                            message: None,
                        },
                    );
                    if confirmed.is_err() || crate::window_lifecycle::setup_tray(app).is_err() {
                        self.fail(
                            app,
                            &input.attempt_id,
                            BootStage::Workbench,
                            IssueCode::Permission,
                            true,
                        );
                    } else {
                        let elapsed = self
                            .inner
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .started_at
                            .elapsed()
                            .as_millis();
                        diagnostics::log_step(
                            "boot.workbench_ready",
                            &input.attempt_id,
                            elapsed,
                            "committed",
                            "",
                            "",
                        );
                        self.change(app, &input.attempt_id, |inner| {
                            inner.snapshot.phase = BootPhase::Ready;
                            inner.snapshot.stage = BootStage::Ready;
                            inner.snapshot.capabilities = BootCapabilities {
                                retry: false,
                                exit: false,
                            };
                            inner.snapshot.issue = None;
                        });
                        crate::updater::schedule_background_checks(app);
                    }
                }
            }
        }
        Ok(self.snapshot())
    }
    pub fn exit(&self, app: &AppHandle, input: BootAttemptInput) -> DesktopResult<()> {
        let snapshot = self.snapshot();
        if snapshot.attempt_id != input.attempt_id || !snapshot.capabilities.exit {
            return Err(issue(
                IssueCode::Busy,
                "当前启动状态不能通过此入口退出。",
                RecoveryAction::None,
            ));
        }
        self.terminate();
        app.state::<ModelBackend>().shutdown();
        app.exit(0);
        Ok(())
    }
}

#[tauri::command]
pub fn boot_get_state(service: tauri::State<'_, Arc<BootRuntime>>) -> BootSnapshot {
    service.snapshot()
}
#[tauri::command]
pub async fn boot_retry(app: AppHandle, input: BootAttemptInput) -> DesktopResult<BootSnapshot> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Arc<BootRuntime>>().retry(&app, input))
        .await
        .map_err(|_| {
            issue(
                IssueCode::Internal,
                "启动重试结果未确认，请读取当前状态。",
                RecoveryAction::Retry,
            )
        })?
}
#[tauri::command]
pub async fn boot_acknowledge_frontend(
    app: AppHandle,
    input: BootFrontendInput,
) -> DesktopResult<BootSnapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Arc<BootRuntime>>().acknowledge(&app, input)
    })
    .await
    .map_err(|_| {
        issue(
            IssueCode::Internal,
            "前端启动确认未完成，请读取当前状态。",
            RecoveryAction::Retry,
        )
    })?
}
#[tauri::command]
pub fn boot_exit(
    app: AppHandle,
    service: tauri::State<'_, Arc<BootRuntime>>,
    input: BootAttemptInput,
) -> DesktopResult<()> {
    service.exit(&app, input)
}
