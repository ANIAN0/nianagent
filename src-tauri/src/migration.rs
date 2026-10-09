use crate::{
    storage::{self, Bootstrap, DataMarker, StoragePaths},
    windows_guard,
};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

pub fn worker(paths: &StoragePaths, action: &str, record: &Path) -> Result<Value, String> {
    run_worker(&paths.install, action, record)
}
fn run_worker(install: &Path, action: &str, record: &Path) -> Result<Value, String> {
    let (node, script) = if cfg!(debug_assertions) {
        (
            PathBuf::from("node"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/migration-worker.mjs"),
        )
    } else {
        (
            install.join("runtime/node.exe"),
            install.join("runtime/migration-worker.mjs"),
        )
    };
    let mut command = Command::new(dunce::simplified(&node));
    command
        .arg(dunce::simplified(&script))
        .arg(action)
        .arg(dunce::simplified(record))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "无法启动内置数据迁移服务。")?;
    let stderr = child.stderr.take().ok_or("迁移诊断通道不可用。")?;
    let diagnostics = std::thread::spawn(move || {
        let mut message = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut message);
        message
    });
    let stdout = child.stdout.take().ok_or("迁移进度通道不可用。")?;
    let mut last = None;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            if action == "--copy" && value["phase"].is_string() {
                if let Ok(mut current) = storage::read_json(record) {
                    for key in ["phase", "completedFiles", "totalFiles", "retainedCopies"] {
                        if !value[key].is_null() {
                            current[key] = value[key].clone();
                        }
                    }
                    storage::atomic_json(record, &current)?;
                }
                let label = match value["phase"].as_str() {
                    Some("copying") => "正在复制",
                    Some("validating") => "正在核验",
                    _ => "正在处理",
                };
                windows_guard::progress(&format!(
                    "Moon数据迁移：{label}，已完成 {} / {} 个文件。原数据保留。",
                    value["completedFiles"], value["totalFiles"]
                ));
            }
            last = Some(value);
        }
    }
    let status = child.wait().map_err(|_| "无法确认迁移服务结束。")?;
    let message = diagnostics.join().unwrap_or_default();
    if !status.success() {
        // 只接受本地worker明确标记的受控诊断，普通stderr/第三方异常不公开。
        let public = message
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .find(|value| {
                value["migrationFailure"] == true
                    && matches!(
                        value["code"].as_str(),
                        Some("migration_validation" | "migration_internal")
                    )
            })
            .and_then(|value| {
                value["message"]
                    .as_str()
                    .filter(|message| message.len() <= 1024)
                    .map(str::to_owned)
            });
        return Err(public.unwrap_or(
            "数据迁移未完成，原数据和维护记录保留，请检查权限、占用或存储内容。".into(),
        ));
    }
    last.ok_or("迁移服务没有返回确认结果。".into())
}
pub fn record_file(paths: &StoragePaths, id: &str) -> PathBuf {
    paths.control.join(format!("{id}.json"))
}
pub fn migration_record(paths: &StoragePaths, id: &str, target: &str) -> Value {
    let previous = storage::read_json(&record_file(paths, id))
        .ok()
        .filter(|record| {
            record["operationId"] == id
                && record["kind"] == "migration"
                && record["committed"] == false
                && record["dataSetId"] == paths.marker.data_set_id
                && record["generation"] == paths.bootstrap.generation
                && record["sourceDirectory"] == storage::text(&paths.data)
                && record["targetDirectory"] == target
        });
    let retained = previous
        .and_then(|record| record["retainedCopies"].as_array().cloned())
        .filter(|paths| {
            paths.len() <= 1000
                && paths.iter().all(|path| {
                    path.as_str()
                        .is_some_and(|path| Path::new(path).is_absolute())
                })
        })
        .unwrap_or_default();
    json!({"operationId":id,"kind":"migration","sourceDirectory":storage::text(&paths.data),"targetDirectory":target,"installDirectory":storage::text(&paths.install),"controlDirectory":storage::text(&paths.control),"bootstrapFile":storage::text(&paths.bootstrap_file),"dataSetId":paths.marker.data_set_id,"generation":paths.bootstrap.generation,"shutdownStarted":false,"committed":false,"phase":"preparing","parentPid":std::process::id(),"legacy":false,"retainedCopies":retained})
}

pub fn import_legacy_before_start(
    install: &Path,
    control: &Path,
    bootstrap_file: &Path,
    target: &mut PathBuf,
    bootstrap: &mut Bootstrap,
) -> Result<(), String> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return Ok(());
    };
    let source = local.join("Moon/models");
    let profile = local.join("local.moon.desktop");
    if !source.exists() && !profile.join("EBWebView").exists() {
        return Ok(());
    }
    windows_guard::require_single_user_session()?;
    let choice = rfd::MessageDialog::new().set_title("迁移已有Moon数据").set_description(format!("发现旧版Moon数据：{}\n新数据目录：{}\n将复制业务记录、完整桌面profile和日志，保留原数据。\n是：迁移并启动；否：选择其他新空目录；取消：退出。", storage::text(&source), storage::text(target))).set_buttons(rfd::MessageButtons::YesNoCancel).show();
    match choice {
        rfd::MessageDialogResult::Yes => {}
        rfd::MessageDialogResult::No => {
            *target = rfd::FileDialog::new()
                .set_title("选择新的Moon专用空数据目录")
                .pick_folder()
                .ok_or("已取消旧数据迁移。")?;
            bootstrap.data_root = target.clone();
        }
        _ => return Err("已取消旧数据迁移，原目录保留。".into()),
    }
    let guard = windows_guard::Guard::create(false)?;
    guard.show();
    // 首次导入在bootstrap提交前中断，也必须显式恢复同一数据集/操作，不能生成另一套身份。
    let previous = fs::read_dir(control)
        .map_err(|_| "无法读取旧版迁移恢复记录。")?
        .filter_map(Result::ok)
        .filter_map(|entry| storage::read_json(&entry.path()).ok())
        .find(|record| {
            record["legacy"] == true
                && record["kind"] == "migration"
                && record["committed"] == false
                && record["generation"] == 0
                && record["sourceDirectory"] == storage::text(&source)
                && record["legacyProfileDirectory"] == storage::text(&profile)
                && record["targetDirectory"] == storage::text(target)
                && record["installDirectory"] == storage::text(install)
                && record["controlDirectory"] == storage::text(control)
                && record["bootstrapFile"] == storage::text(bootstrap_file)
                && record["operationId"]
                    .as_str()
                    .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
                && record["dataSetId"]
                    .as_str()
                    .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
        });
    let mut record = if let Some(record) = previous {
        bootstrap.data_set_id = record["dataSetId"]
            .as_str()
            .ok_or("旧版迁移身份无效。")?
            .into();
        record
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        json!({"operationId":id,"kind":"migration","sourceDirectory":storage::text(&source),"targetDirectory":storage::text(target),"installDirectory":storage::text(install),"controlDirectory":storage::text(control),"bootstrapFile":storage::text(bootstrap_file),"dataSetId":bootstrap.data_set_id,"generation":0,"shutdownStarted":true,"committed":false,"phase":"copying","legacy":true,"legacyTempDirectory":std::env::temp_dir(),"legacyProfileDirectory":storage::text(&profile)})
    };
    let id = record["operationId"]
        .as_str()
        .ok_or("旧版迁移身份缺失。")?
        .to_owned();
    let file = control.join(format!("{id}.json"));
    storage::atomic_json(&file, &record)?;
    let result = (|| -> Result<(), String> {
        storage::validate_tree(&source)?;
        ensure_profile_released(&profile)?;
        if !source.exists() {
            fs::create_dir_all(&source).map_err(|_| "无法持有旧版后端排他租约。")?;
        }
        run_worker(install, "--inspect", &file)?;
        storage::private_directory(target, true)?;
        let copied = run_worker(install, "--copy", &file)?;
        record = storage::read_json(&file)?;
        storage::private_directory(target, false)?;
        storage::atomic_json(bootstrap_file, bootstrap)?;
        record["committed"] = json!(true);
        record["phase"] = json!("handedOff");
        record["generation"] = json!(bootstrap.generation);
        record["completedFiles"] = copied["fileCount"].clone();
        record["totalFiles"] = copied["fileCount"].clone();
        storage::atomic_json(&file, &record)?;
        storage::atomic_json(&control.join("last-maintenance.json"), &record)?;
        Ok(())
    })();
    if let Err(message) = result {
        if let Ok(saved) = storage::read_json(&file) {
            record = saved;
        }
        record["phase"] = json!("failed");
        record["message"] = json!(message);
        let _ = storage::atomic_json(&file, &record);
        let _ = storage::atomic_json(&control.join("last-maintenance.json"), &record);
        return Err(message);
    }

    Ok(())
}
fn ensure_profile_released(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    storage::reject_links(root)?;
    for entry in fs::read_dir(root).map_err(|_| "无法核验旧profile文件占用。")? {
        let path = entry.map_err(|_| "无法读取profile目录。")?.path();
        storage::reject_links(&path)?;
        if path.is_dir() {
            ensure_profile_released(&path)?;
        } else {
            let mut options = fs::OpenOptions::new();
            options.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(0);
            }
            options
                .open(path)
                .map_err(|_| "WebView或其他程序仍占用旧profile，请完全退出后重试；未复制。")?;
        }
    }
    Ok(())
}
pub fn spawn_helper(paths: &StoragePaths, id: &str) -> Result<(), String> {
    let file = record_file(paths, id);
    let mut record = storage::read_json(&file)?;
    if record["operationId"] != id || record["shutdownStarted"] != true {
        return Err("维护父进程身份未确认。".into());
    }
    let nonce = uuid::Uuid::new_v4().to_string();
    record["helperNonce"] = json!(nonce);
    storage::atomic_json(&file, &record)?;
    let mut command = Command::new(std::env::current_exe().map_err(|_| "无法定位维护程序。")?);
    command.args(["--moon-maintenance", id]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "无法启动受控维护进程。")?;
    for _ in 0..200 {
        if storage::read_json(&paths.control.join(format!("{id}.ready"))).is_ok_and(|ready| {
            ready["operationId"] == id
                && ready["helperNonce"] == nonce
                && ready["helperPid"].as_u64() == Some(child.id() as u64)
        }) {
            return Ok(());
        }
        if child
            .try_wait()
            .map_err(|_| "无法核对维护进程。")?
            .is_some()
        {
            return Err("维护进程未建立安全屏障，原数据保留。".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("维护进程握手超时，原数据保留，请重启恢复。".into())
}
pub fn maintenance_entry() -> Result<bool, String> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) != Some("--moon-maintenance") {
        return Ok(false);
    }
    let id = args
        .get(2)
        .filter(|value| uuid::Uuid::parse_str(value).is_ok())
        .ok_or("维护操作身份无效。")?;
    let install = std::env::current_exe()
        .map_err(|_| "无法定位维护程序。")?
        .parent()
        .ok_or("程序路径无效。")?
        .to_path_buf();
    let base = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.dev/moon")
    } else {
        install.clone()
    };
    let control = base.join(".moon-control");
    let file = control.join(format!("{id}.json"));
    storage::private_directory(&control, false)?;
    let mut record = storage::read_json(&file)?;
    if record["operationId"] != id.as_str()
        || record["controlDirectory"] != storage::text(&control)
        || record["installDirectory"] != storage::text(&install)
        || record["shutdownStarted"] != true
    {
        return Err("维护记录身份不匹配，未执行。".into());
    }
    let guard = windows_guard::Guard::create(true)?;
    let nonce = record["helperNonce"]
        .as_str()
        .filter(|value| uuid::Uuid::parse_str(value).is_ok())
        .ok_or("维护握手身份缺失。")?;
    storage::atomic_json(
        &control.join(format!("{id}.ready")),
        &json!({"operationId":id,"helperNonce":nonce,"helperPid":std::process::id()}),
    )?;
    guard.show();
    let result = (|| -> Result<(), String> {
        windows_guard::wait_parent(
            record["parentPid"].as_u64().ok_or("维护父进程身份缺失。")? as u32
        )?;
        let _install_lock = storage::exclusive(&control.join("installation.lock"))?;
        let source = PathBuf::from(record["sourceDirectory"].as_str().ok_or("源目录缺失。")?);
        let _dataset_lock = storage::exclusive(&source.join(".moon-data.lock"))?;
        windows_guard::require_single_user_session()?;
        storage::validate_tree(&source)?;
        ensure_profile_released(&source.join("webview"))?;
        record["phase"] = json!("copying");
        storage::atomic_json(&file, &record)?;
        let copied = run_worker(&install, "--copy", &file)?;
        record = storage::read_json(&file)?;
        let target = PathBuf::from(record["targetDirectory"].as_str().ok_or("目标目录缺失。")?);
        storage::private_directory(&target, false)?;
        let marker: DataMarker =
            serde_json::from_value(storage::read_json(&target.join("moon-data.json"))?)
                .map_err(|_| "目标数据集标记无效。")?;
        if marker.data_set_id != record["dataSetId"].as_str().unwrap_or("") {
            return Err("目标数据集身份不匹配。".into());
        }
        let bootstrap = Bootstrap {
            format_version: 1,
            generation: record["generation"].as_u64().ok_or("引导代次缺失。")? + 1,
            data_root: target,
            data_set_id: marker.data_set_id,
        };
        let bootstrap_file =
            PathBuf::from(record["bootstrapFile"].as_str().ok_or("引导路径缺失。")?);
        if bootstrap_file
            != base.join(if cfg!(debug_assertions) {
                "bootstrap.json"
            } else {
                "moon.bootstrap.json"
            })
        {
            return Err("引导路径越界。".into());
        }
        storage::atomic_json(&bootstrap_file, &bootstrap)?;
        record["committed"] = json!(true);
        record["generation"] = json!(bootstrap.generation);
        record["phase"] = json!("handedOff");
        record["completedFiles"] = copied["fileCount"].clone();
        record["totalFiles"] = copied["fileCount"].clone();
        storage::atomic_json(&file, &record)?;
        storage::atomic_json(&control.join("last-maintenance.json"), &record)?;
        Ok(())
    })();
    if let Err(message) = &result {
        if let Ok(persisted) = storage::read_json(&file) {
            record = persisted;
        }
        record["phase"] = json!("failed");
        record["message"] = json!(message);
        let _ = storage::atomic_json(&file, &record);
        let _ = storage::atomic_json(&control.join("last-maintenance.json"), &record);
        crate::window_lifecycle::report_host_error(message);
    }
    drop(guard);
    let mut command = Command::new(std::env::current_exe().map_err(|_| "无法定位重启程序。")?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|_| "迁移维护已结束，请手动重新打开Moon。")?;
    result.map(|_| true)
}
