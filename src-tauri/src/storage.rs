use crate::desktop_contract_generated::{StorageInfo, StorageSource};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bootstrap {
    pub format_version: u64,
    pub generation: u64,
    pub data_root: PathBuf,
    pub data_set_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataMarker {
    pub data_set_id: String,
    pub schema_version: u64,
    pub minimum_app_version: String,
}
#[derive(Clone)]
pub struct StoragePaths {
    pub install: PathBuf,
    pub control: PathBuf,
    pub bootstrap_file: PathBuf,
    pub data: PathBuf,
    pub bootstrap: Bootstrap,
    pub marker: DataMarker,
    pub source: StorageSource,
    pub _locks: Arc<Vec<File>>,
    pub initial_used_bytes: u64,
}
pub fn text(path: &Path) -> String {
    dunce::simplified(path).to_string_lossy().into_owned()
}
pub fn read_json(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(
        &fs::read(path).map_err(|_| format!("无法读取 {}，原文件保留。", text(path)))?,
    )
    .map_err(|_| format!("{} 内容损坏，原文件保留。", text(path)))
}
pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("保存路径无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建维护目录。")?;
    let temporary = parent.join(format!(".moon-write-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "无法创建维护记录。")?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|_| "维护记录编码失败。")?)
        .and_then(|_| file.sync_all())
        .map_err(|_| "维护记录未能落盘。")?;
    drop(file);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // 同卷临时记录已sync，Windows替换现有bootstrap也必须原子且写穿。
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err("维护记录原子提交失败，旧记录保留。".into());
        }
    }
    #[cfg(not(windows))]
    fs::rename(&temporary, path).map_err(|_| "维护记录提交失败。")?;
    Ok(())
}
pub fn exclusive(path: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|_| "维护锁文件不可写，请检查目录权限。")?;
    file.try_lock_exclusive()
        .map_err(|_| "Moon 已在运行或该目录正在维护，请先退出其他 Moon。")?;
    Ok(file)
}
pub fn reject_links(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        if let Ok(meta) = fs::symlink_metadata(ancestor) {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("数据路径包含链接或junction，请选择真实专用目录。".into());
                }
            }
            if meta.file_type().is_symlink() {
                return Err("数据路径包含符号链接。".into());
            }
        }
    }
    Ok(())
}
pub fn private_directory(path: &Path, create: bool) -> Result<(), String> {
    reject_links(path)?;
    let existed = path.exists();
    let empty = !existed || fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none());
    if create {
        fs::create_dir_all(path)
            .map_err(|_| format!("目录不可写：{}。请使用当前用户可写的安装位置。", text(path)))?;
    }
    #[cfg(windows)]
    {
        // Windows权限使用实际DACL，不把POSIX mode当作私密性证明。脚本固定，路径仅经环境参数传入。
        let script = r#"$ErrorActionPreference='Stop'; $p=$env:MOON_ACL_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $prior=[IO.Directory]::GetAccessControl($p); if($env:MOON_ACL_NEW -ne '1' -and $prior.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'unsafe owner'}; if($env:MOON_ACL_CREATE -eq '1'){ $a=[System.Security.AccessControl.DirectorySecurity]::new(); if($prior.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){$a.SetOwner($sid)}; $a.SetAccessRuleProtection($true,$false); foreach($s in @($sid.Value,'S-1-5-18','S-1-5-32-544')) { $id=[System.Security.Principal.SecurityIdentifier]::new($s); $r=[System.Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($r) }; [IO.Directory]::SetAccessControl($p,$a) }; $a=[IO.Directory]::GetAccessControl($p); if($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or -not $a.AreAccessRulesProtected){throw 'unsafe owner or inheritance'}; $full=$false; foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){ if($r.AccessControlType -eq 'Allow'){ $s=$r.IdentityReference.Value; if($s -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'unsafe ACL'}; if($s -eq $sid.Value -and ($r.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl){$full=$true} } }; if(-not $full){throw 'current user full control required'}; $f=Join-Path $p ('.moon-permission-'+[guid]::NewGuid().ToString()); [IO.File]::WriteAllText($f,''); [IO.File]::Delete($f)"#;
        let mut command = Command::new("powershell.exe");
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        let status = command
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("MOON_ACL_PATH", dunce::simplified(path))
            .env("MOON_ACL_CREATE", if create && empty { "1" } else { "0" })
            .env("MOON_ACL_NEW", if !existed { "1" } else { "0" })
            .output()
            .map_err(|_| "无法核验Windows数据目录权限。")?;
        if !status.status.success() {
            return Err(format!(
                "目录必须由当前用户独占读写：{}。请选择新的私有专用目录。",
                text(path)
            ));
        }
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if !existed {
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))
                .map_err(|_| "无法设置目录权限。")?;
        }
        if fs::metadata(path).map_err(|_| "无法读取目录权限。")?.mode() & 0o077 != 0 {
            return Err("数据目录必须仅当前用户可访问。".into());
        }
    }
    Ok(())
}
impl StoragePaths {
    pub fn initialize() -> Result<Self, String> {
        let install = dunce::canonicalize(
            std::env::current_exe()
                .map_err(|_| "无法定位Moon程序。")?
                .parent()
                .ok_or("程序目录无效。")?,
        )
        .map_err(|_| "程序目录不存在。")?;
        let base = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.dev/moon")
        } else {
            install.clone()
        };
        // 安装根与引导控制目录同样必须私有，防止其他用户替换bootstrap。
        reject_links(&base)?;
        private_directory(&base, true)?;
        let control = base.join(".moon-control");
        private_directory(&control, true)?;
        let installation_lock = exclusive(&control.join("installation.lock"))?;
        let bootstrap_file = base.join(if cfg!(debug_assertions) {
            "bootstrap.json"
        } else {
            "moon.bootstrap.json"
        });
        let override_root = if cfg!(debug_assertions) {
            std::env::var_os("MOON_DATA_DIR").map(PathBuf::from)
        } else {
            None
        };
        let existing = bootstrap_file.exists();
        let mut bootstrap: Bootstrap = if existing {
            serde_json::from_value(read_json(&bootstrap_file)?)
                .map_err(|_| "数据引导格式损坏，不能创建空数据替代。")?
        } else {
            Bootstrap {
                format_version: 1,
                generation: 1,
                data_root: PathBuf::from("data"),
                data_set_id: Uuid::new_v4().to_string(),
            }
        };
        if bootstrap.format_version != 1
            || bootstrap.generation == 0
            || bootstrap.data_set_id.is_empty()
            || (!bootstrap.data_root.is_absolute() && bootstrap.data_root != PathBuf::from("data"))
        {
            return Err("数据引导版本不兼容。".into());
        }
        let mut data = override_root.clone().unwrap_or_else(|| {
            if bootstrap.data_root.is_absolute() {
                bootstrap.data_root.clone()
            } else {
                base.join(&bootstrap.data_root)
            }
        });
        if !data.is_absolute() {
            return Err("数据目录必须是绝对路径。".into());
        }
        reject_links(&data)?;
        let mut relocated = false;
        if existing && override_root.is_none() && !data.exists() {
            let selected = rfd::FileDialog::new()
                .set_title("原数据目录失联，请重新定位同一Moon数据集")
                .pick_folder()
                .ok_or("原数据目录失联，已退出；不会创建另一套空数据。")?;
            let marker: DataMarker =
                serde_json::from_value(read_json(&selected.join("moon-data.json"))?)
                    .map_err(|_| "所选目录不是有效Moon数据集。")?;
            if marker.data_set_id != bootstrap.data_set_id {
                return Err("所选目录与原数据集身份不同，未切换。".into());
            }
            data = selected;
            bootstrap.data_root = data.clone();
            bootstrap.generation += 1;
            relocated = true;
        }
        if !existing && override_root.is_none() && !cfg!(debug_assertions) {
            crate::migration::import_legacy_before_start(
                &install,
                &control,
                &bootstrap_file,
                &mut data,
                &mut bootstrap,
            )?;
        }
        let marker_file = data.join("moon-data.json");
        let marker: DataMarker = if marker_file.exists() {
            let value: DataMarker = serde_json::from_value(read_json(&marker_file)?)
                .map_err(|_| "数据集标记损坏，原目录保留。")?;
            if override_root.is_some() {
                bootstrap.data_set_id = value.data_set_id.clone();
            }
            value
        } else {
            if data.exists()
                && fs::read_dir(&data)
                    .map_err(|_| "无法读取数据目录。")?
                    .next()
                    .is_some()
            {
                return Err(
                    "未标记的非空数据目录不能直接接管，请选择新的空目录或恢复原引导。".into(),
                );
            }
            private_directory(&data, true)?;
            let value = DataMarker {
                data_set_id: bootstrap.data_set_id.clone(),
                schema_version: 1,
                minimum_app_version: "0.1.0".into(),
            };
            atomic_json(&marker_file, &value)?;
            value
        };
        if marker.data_set_id != bootstrap.data_set_id || marker.schema_version != 1 {
            return Err("数据集身份或存储版本不匹配，已停止启动。".into());
        }
        let minimum = semver::Version::parse(&marker.minimum_app_version)
            .map_err(|_| "数据最低版本标记损坏。")?;
        let current =
            semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|_| "程序版本无效。")?;
        if current < minimum {
            return Err(
                "当前Moon版本低于数据最低兼容版本，请使用更新的程序；不会降级或清空数据。".into(),
            );
        }
        private_directory(&data, false)?;
        let dataset_lock = exclusive(&data.join(".moon-data.lock"))?;
        for directory in ["tmp", "logs", "updates", "maintenance", "webview", "agent"] {
            fs::create_dir_all(data.join(directory)).map_err(|_| "无法创建Moon数据子目录。")?;
        }
        if override_root.is_none() && (!bootstrap_file.exists() || relocated) {
            atomic_json(&bootstrap_file, &bootstrap)?;
        }
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
            return Err("检测到外部WEBVIEW2_USER_DATA_FOLDER覆盖，请移除该覆盖后启动，避免profile写到其他目录。".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            for hive in ["HKCU", "HKLM"] {
                if Command::new("reg.exe")
                    .creation_flags(0x08000000)
                    .args([
                        "query",
                        &format!(
                            r"{hive}\Software\Policies\Microsoft\Edge\WebView2\UserDataFolder"
                        ),
                    ])
                    .output()
                    .is_ok_and(|result| result.status.success())
                {
                    return Err(
                        "检测到Windows WebView2数据目录策略覆盖，请先由系统管理员移除冲突策略。"
                            .into(),
                    );
                }
            }
        }
        // Rust2024环境写入集中于最早启动单线程，早于Tauri/Node/日志与updater。
        unsafe {
            std::env::set_var("TMP", data.join("tmp"));
            std::env::set_var("TEMP", data.join("tmp"));
        }
        if dunce::canonicalize(std::env::temp_dir()).map_err(|_| "临时目录不可用。")?
            != dunce::canonicalize(data.join("tmp")).map_err(|_| "临时目录不可用。")?
        {
            return Err("Moon临时目录未按数据根生效，已停止启动。".into());
        }
        let source = if override_root.is_some() {
            StorageSource::DevelopmentEnvironment
        } else if cfg!(debug_assertions) && bootstrap.data_root == PathBuf::from("data") {
            StorageSource::DevelopmentDefault
        } else if bootstrap.data_root == PathBuf::from("data") {
            StorageSource::Installation
        } else {
            StorageSource::Custom
        };
        let initial_used_bytes = directory_size(&data)?;
        Ok(Self {
            initial_used_bytes,
            install,
            control,
            bootstrap_file,
            data: dunce::canonicalize(data).map_err(|_| "数据目录不存在。")?,
            bootstrap,
            marker,
            source,
            _locks: Arc::new(vec![installation_lock, dataset_lock]),
        })
    }
    pub fn info(&self) -> StorageInfo {
        let mut retained: Vec<String> =
            read_json(&self.data.join("maintenance/retained-copies.json"))
                .ok()
                .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
                .unwrap_or_default()
                .into_iter()
                .filter(|value| value != &text(&self.data) && Path::new(value).is_dir())
                .collect();
        // 失败副本的路径也来自受保护维护记录，避免bootstrap未提交时失去可见诊断。
        if let Ok(records) = fs::read_dir(&self.control) {
            for entry in records.filter_map(Result::ok) {
                if let Ok(record) = read_json(&entry.path()) {
                    if record["dataSetId"] == self.marker.data_set_id {
                        if let Some(copies) = record["retainedCopies"].as_array() {
                            for copy in copies.iter().filter_map(Value::as_str) {
                                if Path::new(copy).is_absolute()
                                    && Path::new(copy).is_dir()
                                    && !retained.iter().any(|path| path == copy)
                                {
                                    retained.push(copy.into());
                                }
                            }
                        }
                    }
                }
            }
        }
        let mappings = read_json(&self.data.join("maintenance/directory-mappings.json"))
            .ok()
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        StorageInfo {
            data_directory: text(&self.data),
            install_directory: text(&self.install),
            source: self.source.clone(),
            data_set_id: self.marker.data_set_id.clone(),
            generation: self.bootstrap.generation,
            schema_version: self.marker.schema_version,
            legacy_copy_retained: !retained.is_empty(),
            directory_mappings: mappings,
            retained_copy_directories: retained,
            used_bytes: self.initial_used_bytes,
            available_bytes: fs2::available_space(&self.data).ok(),
        }
    }
    pub fn configure(
        &self,
        context: &mut tauri::Context<tauri::Wry>,
    ) -> Vec<tauri::utils::config::WindowConfig> {
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(self.data.clone()),
        );
        let mut windows = Vec::new();
        for window in &mut context.config_mut().app.windows {
            // Tauri 2.12.1 的配置转换没有传递 data_directory；必须由显式 builder 设置。
            // 先禁止自动创建，避免它在实际 profile 核验之前向数据根另建一个 profile。
            window.data_directory = None;
            if window.create {
                windows.push(window.clone());
                window.create = false;
            }
        }
        if let Some(key) =
            option_env!("MOON_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty())
        {
            context
                .config_mut()
                .plugins
                .0
                .entry("updater".into())
                .or_insert(json!({}))["pubkey"] = json!(key);
        }
        windows
    }
}

fn directory_size(path: &Path) -> Result<u64, String> {
    let mut bytes = 0u64;
    for entry in fs::read_dir(path).map_err(|_| "无法统计数据目录，未继续启动。")? {
        let path = entry.map_err(|_| "无法读取数据文件元数据。")?.path();
        reject_links(&path)?;
        let metadata = fs::metadata(&path).map_err(|_| "无法读取数据文件大小。")?;
        bytes = bytes.saturating_add(if metadata.is_dir() {
            directory_size(&path)?
        } else {
            metadata.len()
        });
    }
    Ok(bytes)
}

/// 离线复制前重新核验整个业务树，覆盖普通symlink之外的所有Windows reparse类型。
pub fn validate_tree(path: &Path) -> Result<(), String> {
    if path.exists() {
        directory_size(path)?;
    }
    Ok(())
}
