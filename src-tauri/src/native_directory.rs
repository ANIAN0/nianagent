use serde_json::{Value, json};
use std::{
    io::Write,
    process::ChildStdin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

pub type SharedInput = Arc<Mutex<Option<ChildStdin>>>;

pub fn write_message(input: &SharedInput, value: &Value) -> Result<(), String> {
    let mut guard = input.lock().map_err(|_| "宿主输入通道锁异常。")?;
    let pipe = guard.as_mut().ok_or("宿主输入通道已关闭。")?;
    writeln!(pipe, "{value}").map_err(|_| "宿主请求发送失败。".into())
}

// This is a deliberately narrow reverse-RPC capability, shared by web and
// native callers through the existing backend. No JS dialog permission needed.
pub fn handle_request(
    app: Option<&AppHandle>,
    input: &SharedInput,
    busy: &Arc<AtomicBool>,
    value: &Value,
) {
    let Some(id) = value["id"].as_str().filter(|id| id.len() <= 128) else {
        return;
    };
    let reply_error = |message: &str| {
        let _ = write_message(
            input,
            &json!({"id":id,"operation":"$hostReply","error":message}),
        );
    };
    if value["capability"] != "pickDirectory" {
        reply_error("未知宿主能力。");
        return;
    }
    let Some(app) = app else {
        reply_error("系统目录选择器需要桌面宿主。");
        return;
    };
    if busy.swap(true, Ordering::SeqCst) {
        reply_error("已有目录选择窗口，请先完成或取消。");
        return;
    }
    let id = id.to_owned();
    let input = input.clone();
    let busy = busy.clone();
    let mut dialog = app.dialog().file().set_title("添加工作区");
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_folder(move |result| {
        let value = match result {
            None => json!({"id":id,"operation":"$hostReply","result":null}),
            Some(path) => match path.into_path() {
                Ok(path) => {
                    json!({"id":id,"operation":"$hostReply","result":path.to_string_lossy()})
                }
                Err(_) => json!({"id":id,"operation":"$hostReply","error":"目录路径无法读取。"}),
            },
        };
        // Clear before replying, so a subsequent explicit action may open again.
        busy.store(false, Ordering::SeqCst);
        let _ = write_message(&input, &value);
    });
}
