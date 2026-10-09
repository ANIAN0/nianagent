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
use tauri::{Manager, State};
type Reply = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<String, mpsc::Sender<Reply>>>>;
struct Bridge {
    child: Child,
    input: SharedInput,
    pending: Pending,
}
// 先关闭输入让后端自行收尾，再限时终止子进程；不能让退出无限等待。
impl Drop for Bridge {
    fn drop(&mut self) {
        if let Ok(mut input) = self.input.lock() {
            input.take();
        }
        for _ in 0..40 {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub struct ModelBackend {
    app: Option<tauri::AppHandle>,
    directory_picker_busy: Arc<AtomicBool>,
    stopping: AtomicBool,
    bridge: Mutex<Option<Bridge>>,
    script: PathBuf,
    node: PathBuf,
    directory: PathBuf,
}
impl ModelBackend {
    pub fn new(
        app: &tauri::App,
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
            app: Some(app.handle().clone()),
            directory_picker_busy: Arc::new(AtomicBool::new(false)),
            stopping: AtomicBool::new(false),
            bridge: Mutex::new(None),
            script,
            node,
            directory,
        };
        let ready = backend
            .send("$startup", "$runtime", json!({}))
            .map_err(std::io::Error::other)?;
        ready
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| std::io::Error::other("模型服务启动超时。"))?
            .map_err(std::io::Error::other)?;
        Ok(backend)
    }
    pub fn shutdown(&self) {
        // Mark terminal before waiting for the bridge lock. Pending callers must
        // never create another process while the application is exiting.
        self.stopping.store(true, Ordering::SeqCst);
        let mut bridge = self
            .bridge
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        bridge.take();
    }
    pub fn internal(&self, operation: &str, input: Value, timeout: Duration) -> Reply {
        let id = format!("host-{}", uuid::Uuid::new_v4());
        self.send(&id, operation, input)?
            .recv_timeout(timeout)
            .map_err(|_| "后端维护确认超时，状态可能已部分关闭，请重新启动Moon恢复。".to_string())?
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
    ) -> Result<mpsc::Receiver<Reply>, String> {
        let mut bridge = self.bridge.lock().map_err(|_| "模型进程锁异常。")?;
        if self.stopping.load(Ordering::SeqCst) {
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
                .env("MOON_RUNTIME_FILE", self.directory.join("runtime.json"))
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
        let message = json!({"id":request_id,"operation":operation,"input":input});
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
) -> Reply {
    if operation.starts_with('$') {
        return Err("内部宿主命令不可从业务RPC调用。".into());
    }
    let maximum = if operation == "materialUpload" {
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
    let receiver = backend.send(&request_id, &operation, input)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(timeout))
    })
    .await
    .map_err(|_| "请求任务失败。")?;
    match result {
        Ok(value) => value,
        Err(_) => {
            backend.cancel(&request_id);
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
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|_| "无法打开浏览器。")?;
    }
    Ok(())
}
