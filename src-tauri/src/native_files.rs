use crate::{
    desktop_contract_generated::*,
    desktop_runtime::{DesktopResult, issue},
    storage,
};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};

fn failure(message: &str) -> DesktopIssue {
    issue(IssueCode::Validation, message, RecoveryAction::Retry)
}
fn current_file(input: &str) -> DesktopResult<PathBuf> {
    if input.is_empty()
        || input.len() > 16000
        || input.contains('\0')
        || !Path::new(input).is_absolute()
    {
        return Err(failure("请选择实际文件绝对路径。"));
    }
    let path =
        dunce::canonicalize(input).map_err(|_| failure("文件不存在或无法访问，请重新读取。"))?;
    if !path.is_file() {
        return Err(failure("目标不是普通文件。"));
    }
    Ok(path)
}
fn supported(program: &Path) -> bool {
    let name = program
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    matches!(
        name.as_str(),
        "code.exe"
            | "code - insiders.exe"
            | "code-insiders.exe"
            | "vscodium.exe"
            | "codium.exe"
            | "cursor.exe"
            | "windsurf.exe"
            | "zed.exe"
            | "sublime_text.exe"
            | "code"
            | "codium"
            | "cursor"
            | "windsurf"
            | "zed"
            | "sublime_text"
    )
}
#[tauri::command]
pub async fn file_editors() -> DesktopResult<InstalledEditors> {
    tauri::async_runtime::spawn_blocking(installed_editors)
        .await
        .map_err(|_| failure("编辑器检测未完成，请重试。"))
}
fn installed_editors() -> InstalledEditors {
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    let programs = [
        ("Visual Studio Code", "Microsoft VS Code/Code.exe"),
        (
            "VS Code Insiders",
            "Microsoft VS Code Insiders/Code - Insiders.exe",
        ),
        ("VSCodium", "VSCodium/VSCodium.exe"),
        ("Cursor", "cursor/Cursor.exe"),
        ("Windsurf", "Windsurf/Windsurf.exe"),
        ("Zed", "Zed/zed.exe"),
        ("Sublime Text", "Sublime Text/sublime_text.exe"),
    ];
    for variable in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(variable) {
            for (name, path) in programs {
                let base = PathBuf::from(&base);
                candidates.push((name.into(), base.join(path)));
                candidates.push((name.into(), base.join("Programs").join(path)));
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            for name in [
                "code.exe",
                "codium.exe",
                "cursor.exe",
                "windsurf.exe",
                "zed.exe",
                "sublime_text.exe",
                "code",
                "codium",
                "cursor",
                "windsurf",
                "zed",
            ] {
                candidates.push((name.trim_end_matches(".exe").into(), directory.join(name)));
            }
        }
    }
    let mut editors: InstalledEditors = Vec::new();
    for (name, path) in candidates {
        if path.is_file() && supported(&path) {
            let path = storage::text(&path);
            if !editors
                .iter()
                .any(|editor| editor.path.eq_ignore_ascii_case(&path))
            {
                editors.push(InstalledEditor { name, path });
            }
        }
    }
    editors
}
#[tauri::command]
pub async fn file_choose_editor() -> DesktopResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .set_title("选择已安装的 VS Code / VSCodium / Cursor / Windsurf / Zed / Sublime Text")
            .pick_file()
        else {
            return Ok(None);
        };
        if !path.is_file() || !supported(&path) {
            return Err(failure(
                "该程序不在支持的编辑器名单中，请选择已安装的编辑器。",
            ));
        }
        Ok(Some(storage::text(&path)))
    })
    .await
    .map_err(|_| failure("程序选择未能完成。"))?
}
#[tauri::command]
pub async fn file_open(input: FileOpenInput) -> DesktopResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = current_file(&input.path)?;
        let mut command = if let Some(program) = input.program.filter(|value| !value.is_empty()) {
            let program = current_file(&program)?;
            if !supported(&program) {
                return Err(failure("所选程序不是支持的已安装编辑器，请重新选择。"));
            }
            Command::new(program)
        } else {
            Command::new(if cfg!(windows) {
                "explorer.exe"
            } else if cfg!(target_os = "macos") {
                "open"
            } else {
                "xdg-open"
            })
        };
        command.arg(dunce::simplified(&path));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
            .spawn()
            .map_err(|_| failure("外部程序未能启动，请检查已安装软件或重新选择编辑器。"))?;
        Ok(())
    })
    .await
    .map_err(|_| failure("外部打开任务未能完成。"))?
}
fn same_metadata(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    a.len() == b.len()
        && a.modified().ok() == b.modified().ok()
        && a.created().ok() == b.created().ok()
}
fn publish(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(from, to)
    }
}
#[tauri::command]
pub async fn file_export(input: FileExportInput) -> DesktopResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = current_file(&input.path)?;
        let name = Path::new(&input.name)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let Some(destination) = rfd::FileDialog::new()
            .set_title("另存当前原文件")
            .set_file_name(&name)
            .save_file()
        else {
            return Ok(None);
        };
        // The source may have changed while the user chose the destination.
        let current = current_file(&input.path)?;
        if current != path {
            return Err(failure("原引用路径已变化，请重新读取后另存。"));
        }
        if dunce::canonicalize(&destination).ok().as_ref() == Some(&current) {
            return Err(failure("另存目标不能是当前源文件，请选择其他位置。"));
        }
        let parent = destination
            .parent()
            .and_then(|path| dunce::canonicalize(path).ok())
            .ok_or_else(|| failure("保存目录不存在或不可访问。"))?;
        let destination = parent.join(
            destination
                .file_name()
                .ok_or_else(|| failure("保存文件名无效。"))?,
        );
        let temporary = parent.join(format!(".moon-export-{}.tmp", uuid::Uuid::new_v4()));
        let mut staging_created = false;
        let result = (|| {
            let mut source = File::open(&current).map_err(|_| failure("源文件无法读取。"))?;
            let before = source
                .metadata()
                .map_err(|_| failure("源文件状态无法读取。"))?;
            let mut target = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|_| failure("无法在保存目录创建文件。"))?;
            staging_created = true;
            let mut copied = 0_u64;
            let mut bytes = [0_u8; 65536];
            while copied < before.len() {
                let wanted = usize::try_from((before.len() - copied).min(bytes.len() as u64))
                    .unwrap_or(bytes.len());
                let count = source
                    .read(&mut bytes[..wanted])
                    .map_err(|_| failure("原文件读取失败，未保存部分内容。"))?;
                if count == 0 {
                    return Err(failure("原文件读取不完整，未保存部分内容。"));
                }
                target
                    .write_all(&bytes[..count])
                    .map_err(|_| failure("磁盘写入失败，原目标保留。"))?;
                copied += count as u64;
            }
            target
                .sync_all()
                .map_err(|_| failure("文件未能完整保存，原目标保留。"))?;
            let after = source
                .metadata()
                .map_err(|_| failure("原文件状态复查失败。"))?;
            let actual = current_file(&input.path)?;
            let latest = fs::metadata(&actual).map_err(|_| failure("原文件状态复查失败。"))?;
            if current != actual
                || !same_metadata(&before, &after)
                || !same_metadata(&before, &latest)
            {
                return Err(failure(
                    "原文件在复制期间变化，未发布部分结果，请重新另存。",
                ));
            }
            drop(target);
            drop(source);
            publish(&temporary, &destination)
                .map_err(|_| failure("保存目标无法发布，原目标保留。"))?;
            Ok(Some(storage::text(&destination)))
        })();
        // Only this operation's UUID staging file in the verified save directory.
        if result.is_err() && staging_created && temporary.parent() == Some(parent.as_path()) {
            let _ = fs::remove_file(&temporary);
        }
        result
    })
    .await
    .map_err(|_| failure("另存任务未能完成，请检查保存目录。"))?
}
