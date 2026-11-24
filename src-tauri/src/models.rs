use crate::native_directory::{self, SharedInput, write_message};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, State};
/// G20：操作终态统一字段日志（与 Node JSONL schema 字段对齐；供诊断关联 traceId）。
fn log_operation_terminal(
    event: &str,
    trace_id: &str,
    operation_id: &str,
    duration_ms: u128,
    outcome: &str,
    error_code: &str,
    error_cause: &str,
    error_id: &str,
) {
    let record_as_info = outcome == "committed" && (event.starts_with('$') || duration_ms >= 1000);
    let level = if record_as_info {
        "info"
    } else if outcome == "committed" {
        "debug"
    } else if outcome == "unknown" {
        "warn"
    } else {
        "error"
    };
    let line = json!({
        "schemaVersion": 1,
        "timestamp": time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).expect("UTC timestamp"),
        "process": format!("moon-rust-{}", std::process::id()),
        "module": "desktop", "event": event,
        "level": level, "traceId": trace_id, "operationId": operation_id,
        "durationMs": duration_ms.min(u64::MAX as u128) as u64, "outcome": outcome,
        "error": if error_code.is_empty() { Value::Null } else { json!({
            "code": error_code, "errorId": error_id,
            "cause": if error_cause.is_empty() { "" } else { "桌面操作未确认完成；按关联标识查看领域记录。" }
        }) }
    });
    if record_as_info {
        log::info!(target: "moon::terminal", "{line}");
    } else if outcome == "committed" || error_code == "cancelled" {
        log::debug!(target: "moon::terminal", "{line}");
    } else if outcome == "unknown" {
        log::warn!(target: "moon::terminal", "{line}");
    } else {
        log::error!(target: "moon::terminal", "{line}");
    }
}

type Reply = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<String, mpsc::Sender<Reply>>>>;
struct Bridge {
    child: Child,
    input: SharedInput,
    pending: Pending,
}
// 先关闭输入让后端自行收尾，再限时终止子进程；不能让退出无限等待。
impl Bridge {
    fn stop(&mut self) -> Result<(), String> {
        self.input
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take();
        for _ in 0..40 {
            if self
                .child
                .try_wait()
                .map_err(|_| "无法确认业务子进程状态。")?
                .is_some()
            {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if self.child.kill().is_err()
            && self
                .child
                .try_wait()
                .map_err(|_| "无法确认业务子进程状态。")?
                .is_none()
        {
            return Err("业务子进程退出未确认。".into());
        }
        self.child.wait().map_err(|_| "业务子进程退出未确认。")?;
        Ok(())
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        if let Err(message) = self.stop() {
            log::error!("{message}");
        }
    }
}
pub struct ModelBackend {
    app: Option<tauri::AppHandle>,
    directory_picker_busy: Arc<AtomicBool>,
    stopping: AtomicBool,
    terminating: AtomicBool,
    bridge: Mutex<Option<Bridge>>,
    script: PathBuf,
    node: PathBuf,
    directory: PathBuf,
}
impl ModelBackend {
    pub fn new(
        app: &tauri::AppHandle,
        paths: &crate::storage::StoragePaths,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let script = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/rpc.mjs")
        } else {
            app.path().resource_dir()?.join("runtime/rpc.mjs")
        };
        let directory = paths.data.clone();
        let node = if cfg!(debug_assertions) {
            PathBuf::from("node")
        } else {
            app.path().resource_dir()?.join("runtime/node.exe")
        };
        let backend = Self {
            app: Some(app.clone()),
            directory_picker_busy: Arc::new(AtomicBool::new(false)),
            stopping: AtomicBool::new(false),
            terminating: AtomicBool::new(false),
            bridge: Mutex::new(None),
            script,
            node,
            directory,
        };
        Ok(backend)
    }
    /// 对象先受宿主管理，真正启动在后台进行；重试只能在旧子进程退出得到证明后开始。
    pub fn start(&self) -> Result<(), String> {
        {
            let bridge = self.bridge.lock().map_err(|_| "业务进程锁不可用。")?;
            if self.terminating.load(Ordering::SeqCst) {
                return Err("Moon正在退出。".into());
            }
            if bridge.is_some() {
                return Err("旧业务子进程尚未退出，不能重复启动。".into());
            }
            self.stopping.store(false, Ordering::SeqCst);
        }
        self.send("$startup", "$runtime", json!({}), None)?
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "桌面服务启动超时。".to_string())??;
        Ok(())
    }
    /// 启动恢复失败时必须确认Node结束；这不代表保存成功，也不用于维护中的强杀交付。
    pub fn shutdown_confirmed(&self) -> Result<(), String> {
        self.stopping.store(true, Ordering::SeqCst);
        let mut bridge = self
            .bridge
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(child) = bridge.as_mut() {
            child.stop()?;
        }
        bridge.take();
        Ok(())
    }
    pub fn shutdown(&self) {
        // Mark terminal before waiting for the bridge lock. Pending callers must
        // never create another process while the application is exiting.
        self.terminating.store(true, Ordering::SeqCst);
        self.stopping.store(true, Ordering::SeqCst);
        let mut bridge = self
            .bridge
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        bridge.take();
    }
    pub fn internal(&self, operation: &str, input: Value, timeout: Duration) -> Reply {
        let trace_id = uuid::Uuid::new_v4().to_string();
        let id = format!("host-{}-{}", &trace_id[..8], uuid::Uuid::new_v4());
        let started = std::time::Instant::now();
        let outcome_result = self
            .send(&id, operation, input, Some(&trace_id))?
            .recv_timeout(timeout);
        let duration = started.elapsed().as_millis();
        match &outcome_result {
            Ok(Ok(_)) => {
                log_operation_terminal(operation, &trace_id, &id, duration, "committed", "", "", "")
            }
            Ok(Err(_)) => log_operation_terminal(
                operation,
                &trace_id,
                &id,
                duration,
                "unknown",
                "maintenance_failed",
                "维护调用未确认完成。",
                "",
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // 超时无法证明领域是否接受：终态记 unknown
                log_operation_terminal(
                    operation,
                    &trace_id,
                    &id,
                    duration,
                    "unknown",
                    "operation_timeout",
                    "后端维护确认超时，状态可能已部分关闭，请重新启动Moon恢复。",
                    "",
                )
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => log_operation_terminal(
                operation,
                &trace_id,
                &id,
                duration,
                "unknown",
                "operation_failed",
                "后端维护确认通道已断开，请重新启动Moon恢复。",
                "",
            ),
        }
        match outcome_result {
            Ok(value) => Ok(value?),
            Err(_) => Err("后端维护确认超时，状态可能已部分关闭，请重新启动Moon恢复。".to_string()),
        }
    }
    pub fn finish_maintenance_shutdown(&self) -> Result<(), String> {
        self.stopping.store(true, Ordering::SeqCst);
        let mut guard = self.bridge.lock().map_err(|_| "后端进程锁不可用。")?;
        if let Some(bridge) = guard.as_mut() {
            if let Ok(mut input) = bridge.input.lock() {
                input.take();
            }
            for _ in 0..600 {
                match bridge.child.try_wait() {
                    Ok(Some(status)) if status.success() => {
                        guard.take();
                        return Ok(());
                    }
                    Ok(Some(_)) => {
                        return Err("后端退出异常，无法确认全部保存，请重启恢复。".into());
                    }
                    Err(_) => return Err("无法确认后端退出，请重启恢复。".into()),
                    Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                }
            }
            return Err("后端尚未退出；未强杀后假称安全保存，请重新启动恢复。".into());
        }
        Ok(())
    }
    fn send(
        &self,
        request_id: &str,
        operation: &str,
        input: Value,
        trace_id: Option<&str>,
    ) -> Result<mpsc::Receiver<Reply>, String> {
        let mut bridge = self.bridge.lock().map_err(|_| "模型进程锁异常。")?;
        if self.stopping.load(Ordering::SeqCst) || self.terminating.load(Ordering::SeqCst) {
            return Err("Moon 正在退出。".into());
        }
        let exited = bridge
            .as_mut()
            .is_some_and(|value| value.child.try_wait().ok().flatten().is_some());
        if exited {
            *bridge = None;
        }
        if bridge.is_none() {
            let mut command = Command::new(dunce::simplified(&self.node));
            command
                // Tauri's release resource_dir is canonical on Windows. Node
                // cannot use its verbatim drive prefix as the entry script.
                .arg(dunce::simplified(&self.script))
                .env("MOON_DATA_DIR", &self.directory)
                .env(
                    "MOON_DESKTOP_PACKAGED",
                    if cfg!(debug_assertions) { "0" } else { "1" },
                )
                .env(
                    "MOON_NOTES_DEV",
                    if cfg!(debug_assertions) { "1" } else { "0" },
                )
                .env("MOON_RUNTIME_FILE", self.directory.join("runtime.json"))
                .env(
                    "MOON_DESKTOP_EXECUTABLE",
                    std::env::current_exe().map_err(|_| "Moon程序路径不可读取。")?,
                )
                .env("MOON_DESKTOP_PID", std::process::id().to_string())
                .env("PI_CODING_AGENT_DIR", self.directory.join("agent"))
                .env("TEMP", self.directory.join("tmp"))
                .env("TMP", self.directory.join("tmp"))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command.spawn().map_err(|error| match error.kind() {
                std::io::ErrorKind::NotFound => {
                    if cfg!(debug_assertions) {
                        "开发运行需要Node.js >=22.19。"
                    } else {
                        "Moon内置Node运行时缺失，请修复程序安装。"
                    }
                }
                std::io::ErrorKind::PermissionDenied => "没有权限启动 Node.js 模型服务。",
                _ => "无法创建模型服务进程，请检查程序安装。",
            })?;
            let input: SharedInput = Arc::new(Mutex::new(Some(
                child.stdin.take().ok_or("模型输入通道不可用。")?,
            )));
            let output = child.stdout.take().ok_or("模型输出通道不可用。")?;
            let stderr = child.stderr.take().ok_or("模型诊断通道不可用。")?;
            // Only retain known classifications; stderr can contain credentials or URLs.
            let diagnostics = std::thread::spawn(move || {
                let mut message = "模型进程已退出，请检查程序安装后重试。";
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if line.contains("MODULE_NOT_FOUND") {
                        message = "模型服务依赖缺失，请重新安装应用。";
                    } else if line.contains("SyntaxError") {
                        message = "模型服务程序解析失败，请检查安装和 Node.js 版本。";
                    } else if line.contains("ERR_UNSUPPORTED") {
                        message = "Node.js 不支持模型服务所需功能，请检查运行时版本。";
                    }
                }
                message
            });
            let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
            let readers = pending.clone();
            let host_input = input.clone();
            let host_app = self.app.clone();
            let picker_busy = self.directory_picker_busy.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(output).lines().map_while(Result::ok) {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        if value["operation"] == "$hostRequest" {
                            native_directory::handle_request(
                                host_app.as_ref(),
                                &host_input,
                                &picker_busy,
                                &value,
                            );
                            continue;
                        }
                        if value["operation"] == "$notify" {
                            // 后端主动通知（如插件包任务完成）：转成 Tauri event，
                            // 远程/Web 端不经过此通道，由各自轮询兜底。
                            if let Some(app) = host_app.as_ref() {
                                let _ = app.emit("moon://plugins-state", value["event"].clone());
                            }
                            continue;
                        }
                        if let Some(id) = value["id"].as_str() {
                            if let Ok(mut map) = readers.lock() {
                                if let Some(sender) = map.remove(id) {
                                    let result = if let Some(error) = value["error"].as_str() {
                                        let failure = if value["issue"].is_object() {
                                            json!({"error": error, "issue": value["issue"]})
                                                .to_string()
                                        } else {
                                            error.to_string()
                                        };
                                        Err(format!("MOON_RPC_REJECTED:{failure}"))
                                    } else {
                                        Ok(value["result"].clone())
                                    };
                                    let _ = sender.send(result);
                                }
                            }
                        }
                    }
                }
                let message = diagnostics.join().unwrap_or("模型诊断读取失败。");
                if let Ok(mut map) = readers.lock() {
                    for (_, sender) in map.drain() {
                        let _ = sender.send(Err(message.into()));
                    }
                }
            });
            *bridge = Some(Bridge {
                child,
                input,
                pending,
            });
        }
        let bridge = bridge.as_mut().ok_or("模型服务未启动。")?;
        let (sender, receiver) = mpsc::channel();
        let mut pending = bridge.pending.lock().map_err(|_| "请求通道不可用。")?;
        if pending.contains_key(request_id) {
            return Err("重复请求 ID。".into());
        }
        // 先登记原请求再写入管道，避免极快回复找不到接收方；发送失败只撤回本身份。
        pending.insert(request_id.to_owned(), sender);
        let message = match trace_id {
            Some(trace) => {
                json!({"id":request_id,"operation":operation,"input":input,"traceId":trace})
            }
            None => json!({"id":request_id,"operation":operation,"input":input}),
        };
        if write_message(&bridge.input, &message).is_err() {
            pending.remove(request_id);
            return Err("模型请求发送失败。".into());
        }
        Ok(receiver)
    }
    // 取消本地等待不证明业务未执行；前端须继续用业务请求 ID 核对持久回执。
    fn cancel(&self, id: &str) {
        if let Ok(mut guard) = self.bridge.lock() {
            if let Some(bridge) = guard.as_mut() {
                if let Ok(mut pending) = bridge.pending.lock() {
                    if let Some(sender) = pending.remove(id) {
                        let _ = sender.send(Err("请求已取消。".into()));
                    }
                }
                let _ = write_message(&bridge.input, &json!({"id":id,"operation":"$cancel"}));
            }
        }
    }
}
#[tauri::command]
pub async fn model_request(
    backend: State<'_, ModelBackend>,
    request_id: String,
    operation: String,
    input: Value,
    trace_id: Option<String>,
) -> Reply {
    if operation.starts_with('$') {
        return Err("内部宿主命令不可从业务RPC调用。".into());
    }
    // G10：桌面命令生成调用链标识并随信封传递；Node 端进入请求上下文，跨进程可按 traceId 关联
    let trace_id = match trace_id {
        Some(value)
            if value.len() == 36 && value.chars().all(|c| c.is_ascii_hexdigit() || c == '-') =>
        {
            value
        }
        _ => uuid::Uuid::new_v4().to_string(),
    };
    if trace_id.len() > 100 {
        return Err("请求参数过大。".into());
    }
    let maximum = if operation == "materialUpload" || operation == "pluginCall" {
        16 * 1024 * 1024
    } else {
        1024 * 1024
    };
    if request_id.len() > 100 || operation.len() > 100 || input.to_string().len() > maximum {
        return Err("请求参数过大。".into());
    }
    let timeout = if operation == "workspaceChoose" || operation == "materialChoose" {
        610
    } else {
        60
    };
    let receiver = backend.send(&request_id, &operation, input, Some(&trace_id))?;
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(timeout))
    })
    .await
    .map_err(|_| "请求任务失败。")?;
    match result {
        Ok(reply) => {
            // G20：桌面业务命令终态统一字段日志；失败分类依据领域回执（MOON_RPC_REJECTED 载荷的 issue.code）
            let (outcome, cause, error_code, error_id) = match &reply {
                Ok(_) => ("committed", String::new(), String::new(), String::new()),
                Err(message) if message == "请求已取消。" => (
                    "unknown",
                    message.clone(),
                    "cancelled".to_string(),
                    String::new(),
                ),
                Err(message) => {
                    let issue = message
                        .strip_prefix("MOON_RPC_REJECTED:")
                        .and_then(|payload| serde_json::from_str::<Value>(payload).ok())
                        .and_then(|payload| payload.get("issue").cloned());
                    let code = issue
                        .as_ref()
                        .and_then(|issue| issue.get("code"))
                        .and_then(|code| code.as_str())
                        .unwrap_or("")
                        .to_string();
                    let error_id = issue
                        .as_ref()
                        .and_then(|issue| issue.get("errorId"))
                        .and_then(|error_id| error_id.as_str())
                        .unwrap_or("")
                        .to_string();
                    // result_unknown 依据领域回执保持 unknown；其余明确拒绝
                    let outcome = if code == "result_unknown"
                        || code.is_empty()
                        || issue
                            .as_ref()
                            .and_then(|issue| issue.get("outcome"))
                            .and_then(Value::as_str)
                            == Some("unknown")
                    {
                        "unknown"
                    } else {
                        "rejected"
                    };
                    (
                        outcome,
                        message.clone(),
                        if code.is_empty() {
                            "operation_failed".to_string()
                        } else {
                            code
                        },
                        error_id,
                    )
                }
            };
            log_operation_terminal(
                &operation,
                &trace_id,
                &request_id,
                started.elapsed().as_millis(),
                outcome,
                &error_code,
                &cause,
                &error_id,
            );
            reply
        }
        Err(_) => {
            backend.cancel(&request_id);
            // 超时取消不证明领域未接受：终态记 unknown
            log_operation_terminal(
                &operation,
                &trace_id,
                &request_id,
                started.elapsed().as_millis(),
                "unknown",
                "operation_timeout",
                "模型服务响应超时。",
                "",
            );
            Err("模型服务响应超时。".into())
        }
    }
}
#[tauri::command]
pub fn cancel_model_request(backend: State<'_, ModelBackend>, request_id: String) {
    backend.cancel(&request_id);
}
#[tauri::command]
pub fn open_authorization_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.contains(['\r', '\n', '\0']) || url.len() > 16000 {
        return Err("授权链接无效。".into());
    }
    open_in_system_browser(&url)
}
/// 本机回环页面（如插件托管的工作台）；仅放行 http loopback，其余交由 HTTPS 命令。
#[tauri::command]
pub fn open_local_url(url: String) -> Result<(), String> {
    let loopback = ["http://127.0.0.1:", "http://localhost:", "http://[::1]:"];
    if !loopback.iter().any(|prefix| url.starts_with(prefix))
        || url.contains(['\r', '\n', '\0'])
        || url.len() > 16000
    {
        return Err("仅支持本机回环地址。".into());
    }
    open_in_system_browser(&url)
}
fn open_in_system_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
    }
    Ok(())
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    fn backend(script: PathBuf, directory: PathBuf) -> ModelBackend {
        ModelBackend {
            app: None,
            directory_picker_busy: Arc::new(AtomicBool::new(false)),
            stopping: AtomicBool::new(false),
            terminating: AtomicBool::new(false),
            bridge: Mutex::new(None),
            script,
            node: "node".into(),
            directory,
        }
    }
    #[test]
    fn real_node_rpc_trace_and_owned_shutdown() {
        let directory =
            std::env::temp_dir().join(format!("moon-native-rpc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let host = backend(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/rpc.mjs"),
            directory.clone(),
        );
        host.start().unwrap();
        assert!(host.start().is_err());
        let trace = uuid::Uuid::new_v4().to_string();
        let response = host
            .send("native-negative", "notAnOperation", json!({}), Some(&trace))
            .unwrap()
            .recv_timeout(Duration::from_secs(20))
            .unwrap()
            .unwrap_err();
        let response: Value =
            serde_json::from_str(response.strip_prefix("MOON_RPC_REJECTED:").unwrap()).unwrap();
        assert_eq!(response["issue"]["traceId"], trace);
        assert_eq!(response["issue"]["errorId"].as_str().unwrap().len(), 8);
        host.shutdown_confirmed().unwrap();
        assert!(host.bridge.lock().unwrap().is_none());
        host.start().unwrap();
        host.shutdown_confirmed().unwrap();
        host.shutdown();
        assert!(host.start().is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn bounded_wait_and_cancel_never_kill_another_child() {
        let directory =
            std::env::temp_dir().join(format!("moon-native-deadline-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("fixture.mjs");
        std::fs::write(&script, "import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);if(p.operation==='$runtime')process.stdout.write(JSON.stringify({id:p.id,result:{version:'fixture'}})+'\\n')})").unwrap();
        let host = backend(script, directory.clone());
        let mut other = Command::new("node")
            .args(["-e", "setInterval(()=>{},1000)"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        host.start().unwrap();
        let started = std::time::Instant::now();
        assert!(
            host.internal("$hold", json!({}), Duration::from_millis(40))
                .is_err()
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        let pending = host.send("cancelled", "$hold", json!({}), None).unwrap();
        host.cancel("cancelled");
        assert_eq!(
            pending
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap_err(),
            "请求已取消。"
        );
        host.shutdown_confirmed().unwrap();
        assert!(other.try_wait().unwrap().is_none());
        other.kill().unwrap();
        other.wait().unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
