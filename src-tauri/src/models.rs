use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
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
    input: Option<ChildStdin>,
    pending: Pending,
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.input.take();
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
    stopping: AtomicBool,
    bridge: Mutex<Option<Bridge>>,
    script: PathBuf,
    directory: PathBuf,
}
impl ModelBackend {
    pub fn new(app: &tauri::App) -> Result<Self, Box<dyn std::error::Error>> {
        let script = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/rpc.mjs")
        } else {
            app.path().resource_dir()?.join("runtime/rpc.mjs")
        };
        let directory = if cfg!(debug_assertions) {
            std::env::var_os("MOON_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().local_data_dir()?.join("Moon/models"))
        } else {
            app.path().local_data_dir()?.join("Moon/models")
        };
        let backend = Self {
            stopping: AtomicBool::new(false),
            bridge: Mutex::new(None),
            script,
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
            let mut command = Command::new("node");
            command
                .arg(&self.script)
                .env("MOON_DATA_DIR", &self.directory)
                .env("MOON_RUNTIME_FILE", self.directory.join("runtime.json"))
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
                    "找不到 Node.js，请安装 Node.js >=22.19 并确认 PATH。"
                }
                std::io::ErrorKind::PermissionDenied => "没有权限启动 Node.js 模型服务。",
                _ => "无法创建模型服务进程，请检查程序安装。",
            })?;
            let input = child.stdin.take().ok_or("模型输入通道不可用。")?;
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
            std::thread::spawn(move || {
                for line in BufReader::new(output).lines().map_while(Result::ok) {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        if let Some(id) = value["id"].as_str() {
                            if let Ok(mut map) = readers.lock() {
                                if let Some(sender) = map.remove(id) {
                                    let result = if let Some(error) = value["error"].as_str() {
                                        Err(error.to_owned())
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
                input: Some(input),
                pending,
            });
        }
        let bridge = bridge.as_mut().ok_or("模型服务未启动。")?;
        let (sender, receiver) = mpsc::channel();
        let mut pending = bridge.pending.lock().map_err(|_| "请求通道不可用。")?;
        if pending.contains_key(request_id) {
            return Err("重复请求 ID。".into());
        }
        pending.insert(request_id.to_owned(), sender);
        let message = json!({"id":request_id,"operation":operation,"input":input});
        if writeln!(
            bridge.input.as_mut().ok_or("模型输入通道已关闭。")?,
            "{message}"
        )
        .is_err()
        {
            pending.remove(request_id);
            return Err("模型请求发送失败。".into());
        }
        Ok(receiver)
    }
    fn cancel(&self, id: &str) {
        if let Ok(mut guard) = self.bridge.lock() {
            if let Some(bridge) = guard.as_mut() {
                if let Ok(mut pending) = bridge.pending.lock() {
                    if let Some(sender) = pending.remove(id) {
                        let _ = sender.send(Err("请求已取消。".into()));
                    }
                }
                if let Some(input) = bridge.input.as_mut() {
                    let _ = writeln!(input, "{}", json!({"id":id,"operation":"$cancel"}));
                }
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
    if request_id.len() > 100 || operation.len() > 100 || input.to_string().len() > 1024 * 1024 {
        return Err("请求参数过大。".into());
    }
    let receiver = backend.send(&request_id, &operation, input)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(60))
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shutdown_is_terminal_and_idempotent() {
        let backend = ModelBackend {
            stopping: AtomicBool::new(false),
            bridge: Mutex::new(None),
            script: PathBuf::from("must-not-be-started.mjs"),
            directory: PathBuf::new(),
        };
        backend.shutdown();
        backend.shutdown();
        assert_eq!(
            backend.send("after-exit", "list", json!({})).unwrap_err(),
            "Moon 正在退出。"
        );
        assert!(backend.bridge.lock().unwrap().is_none());
    }

    #[test]
    fn native_bridge_reports_corrupt_configuration() {
        let directory =
            std::env::temp_dir().join(format!("moon-corrupt-native-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("models.json"), "{broken").unwrap();
        let backend = ModelBackend {
            stopping: AtomicBool::new(false),
            bridge: Mutex::new(None),
            script: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/rpc.mjs"),
            directory: directory.clone(),
        };
        let error = backend
            .send("corrupt", "list", json!({}))
            .unwrap()
            .recv_timeout(Duration::from_secs(60))
            .unwrap()
            .unwrap_err();
        assert!(error.contains("配置文件损坏"), "{error}");
        assert!(!error.contains("Node"));
        assert_eq!(
            std::fs::read_to_string(directory.join("models.json")).unwrap(),
            "{broken"
        );
        drop(backend);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn native_node_bridge_persists_and_deletes_connection() {
        let directory = std::env::temp_dir().join(format!(
            "moon-native-model-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let backend = ModelBackend {
            stopping: AtomicBool::new(false),
            bridge: Mutex::new(None),
            script: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/rpc.mjs"),
            directory: directory.clone(),
        };
        let call = |id: &str, operation: &str, input: Value| {
            backend
                .send(id, operation, input)
                .unwrap()
                .recv_timeout(Duration::from_secs(60))
                .unwrap()
                .unwrap()
        };
        assert_eq!(call("1", "list", json!({})), json!([]));
        let saved = call(
            "2",
            "save",
            json!({"connection":{"id":"native-test","name":"Native Test","kind":"api","endpoint":"http://localhost:11434/v1","credential":"none","apiKey":"","keySaved":false,"headers":"{}","environmentVariable":"","models":[]}}),
        );
        assert_eq!(saved["apiKey"], "");
        assert_eq!(call("3", "list", json!({})).as_array().unwrap().len(), 1);
        call(
            "4",
            "remove",
            json!({"id":"native-test","revision":saved["revision"]}),
        );
        assert_eq!(call("5", "list", json!({})), json!([]));
        drop(backend);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
