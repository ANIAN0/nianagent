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

// 仅开放目录/附件选择这一条反向 RPC；Web 与原生共用后端身份与取消边界。
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
    let files = value["capability"] == "pickFiles";
    if !files && value["capability"] != "pickDirectory" {
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
    let mut dialog = app.dialog().file().set_title(if files {
        "添加附件"
    } else {
        "添加工作区"
    });
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    if files {
        dialog.pick_files(move |result| {
            let value = match result {
                None => json!({"id":id,"operation":"$hostReply","result":null}),
                Some(paths) => {
                    let paths: Result<Vec<String>, _> = paths
                        .into_iter()
                        .map(|path| {
                            path.into_path()
                                .map(|path| path.to_string_lossy().into_owned())
                        })
                        .collect();
                    match paths {
                        Ok(paths) => json!({"id":id,"operation":"$hostReply","result":paths}),
                        Err(_) => {
                            json!({"id":id,"operation":"$hostReply","error":"文件路径无法读取。"})
                        }
                    }
                }
            };
            busy.store(false, Ordering::SeqCst);
            let _ = write_message(&input, &value);
        });
        return;
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
