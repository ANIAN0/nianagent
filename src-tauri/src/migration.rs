use crate::{
    desktop_contract_generated::{StartupFailureStage, StartupIssue, StartupIssueCode},
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

pub fn worker(paths: &StoragePaths, action: &str, record: &Path) -> Result<Value, StartupIssue> {
    worker_detailed(&paths.install, action, record, |_| Ok(()))
}
fn run_worker(install: &Path, action: &str, record: &Path) -> Result<Value, String> {
    worker_detailed(install, action, record, |_| Ok(())).map_err(|issue| issue.message)
}
pub fn failure(
    code: StartupIssueCode,
    stage: StartupFailureStage,
    message: impl Into<String>,
    path: Option<&Path>,
) -> StartupIssue {
    let retryable = !matches!(
        code,
        StartupIssueCode::RuntimeMissing
            | StartupIssueCode::DependencyMissing
            | StartupIssueCode::RuntimeIncompatible
    );
    StartupIssue {
        code,
        stage,
        message: message.into(),
        path: path.map(storage::text),
        retryable,
    }
}
pub fn worker_detailed(
    install: &Path,
    action: &str,
    record: &Path,
    mut progress: impl FnMut(&Value) -> Result<(), String>,
) -> Result<Value, StartupIssue> {
    let (node, script) = if cfg!(debug_assertions) {
        (
            PathBuf::from("node"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/migration-launcher.mjs"),
        )
    } else {
        (
            install.join("runtime/node.exe"),
            install.join("runtime/migration-launcher.mjs"),
        )
    };
    let sandbox = record
        .parent()
        .ok_or_else(|| {
            failure(
                StartupIssueCode::Internal,
                StartupFailureStage::Runtime,
                "迁移控制路径无效。",
                None,
            )
        })?
        .join("startup");
    storage::private_directory(&sandbox, true).map_err(|message| {
        failure(
            StartupIssueCode::Permission,
            StartupFailureStage::Runtime,
            message,
            Some(&sandbox),
        )
    })?;
    for directory in ["tmp", "agent"] {
        fs::create_dir_all(sandbox.join(directory)).map_err(|_| {
            failure(
                StartupIssueCode::Permission,
                StartupFailureStage::Runtime,
                "无法准备私有迁移运行目录。",
                Some(&sandbox),
            )
        })?;
    }
    let mut command = Command::new(dunce::simplified(&node));
    command
        .arg(dunce::simplified(&script))
        .arg(action)
        .arg(dunce::simplified(record))
        .current_dir(&sandbox)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env("MOON_DATA_DIR", &sandbox)
        .env("MOON_RUNTIME_FILE", sandbox.join("runtime.json"))
        .env("PI_CODING_AGENT_DIR", sandbox.join("agent"))
        .env("TMP", sandbox.join("tmp"))
        .env("TEMP", sandbox.join("tmp"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| {
        failure(
            StartupIssueCode::RuntimeMissing,
            StartupFailureStage::Runtime,
            "内置迁移运行服务不可启动，请检查安装资源。",
            Some(&script),
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        failure(
            StartupIssueCode::Internal,
            StartupFailureStage::Runtime,
            "迁移诊断通道不可用。",
            None,
        )
    })?;
    let diagnostics = std::thread::spawn(move || {
        let mut message = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut message);
        message
    });
    let stdout = child.stdout.take().ok_or_else(|| {
        failure(
            StartupIssueCode::Internal,
            StartupFailureStage::Runtime,
            "迁移进度通道不可用。",
            None,
        )
    })?;
    let mut last = None;
    let mut persistence_failure = None;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            if action == "--copy" && value["phase"].is_string() {
                if let Ok(mut current) = storage::read_json(record) {
                    for key in [
                        "phase",
                        "completedFiles",
                        "totalFiles",
                        "retainedCopies",
                        "copiedBytes",
                    ] {
                        if !value[key].is_null() {
                            current[key] = value[key].clone();
                        }
                    }
                    if let Err(message) = storage::atomic_json(record, &current) {
                        persistence_failure = Some(failure(
                            StartupIssueCode::StorageIo,
                            StartupFailureStage::Copying,
                            message,
                            Some(record),
                        ));
                    }
                } else {
                    persistence_failure = Some(failure(
                        StartupIssueCode::StorageIo,
                        StartupFailureStage::Copying,
                        "复制进度未能读回维护记录，原数据与暂存保留。",
                        Some(record),
                    ));
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
            if let Err(message) = progress(&value) {
                persistence_failure = Some(failure(
                    StartupIssueCode::StorageIo,
                    StartupFailureStage::Copying,
                    message,
                    Some(record),
                ));
            }
            last = Some(value);
        }
    }
    let status = child.wait().map_err(|_| {
        failure(
            StartupIssueCode::Internal,
            StartupFailureStage::Copying,
            "无法确认迁移服务结束。",
            None,
        )
    })?;
    let message = diagnostics.join().unwrap_or_default();
    if !status.success() {
        // 只接受本地worker明确标记的受控诊断，普通stderr/第三方异常不公开。
        let public = message
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|value| value["migrationFailure"] == true)
            .filter_map(|value| serde_json::from_value::<StartupIssue>(value["issue"].clone()).ok())
            .find(|issue| issue.message.len() <= 1024);
        let mut public = public.unwrap_or_else(|| {
            failure(
                StartupIssueCode::Internal,
                StartupFailureStage::Runtime,
                "内置迁移服务启动或执行异常，原数据和维护记录保留。请打开诊断目录查看失败阶段。",
                Some(&script),
            )
        });
        if public.path.is_none() && matches!(public.stage, StartupFailureStage::Runtime) {
            public.path = Some(storage::text(&script));
        }
        return Err(public);
    }
    if let Some(issue) = persistence_failure {
        return Err(issue);
    }
    last.filter(|value| {
        if action == "--probe" {
            value["loaded"] == true
        } else if action == "--copy" {
            value["complete"] == true
        } else {
            value["fileCount"].is_u64()
                && value["totalBytes"].is_u64()
                && value["availableBytes"].is_u64()
        }
    })
    .ok_or_else(|| {
        failure(
            StartupIssueCode::Internal,
            StartupFailureStage::Runtime,
            "迁移服务没有返回有效确认结果。",
            None,
        )
    })
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

pub(crate) fn ensure_profile_released(root: &Path) -> Result<(), String> {
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
