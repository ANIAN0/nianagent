use serde_json::{Value, json};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const FILE_BYTES: u64 = 8 * 1024 * 1024;
const RECORD_BYTES: usize = 16 * 1024;
const RETENTION_DAYS: i64 = 14;

fn now() -> String {
    // RFC3339 formatting of a UTC timestamp has no external input.
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("UTC timestamp")
}

struct Journal {
    directory: PathBuf,
    file: PathBuf,
    archive: PathBuf,
    pruned: Option<SystemTime>,
    dropped: u64,
    issue: String,
    status_written: bool,
}
impl Journal {
    fn new(directory: &Path) -> Self {
        Self {
            directory: directory.into(),
            file: directory.join("moon-rust.jsonl"),
            archive: directory.join("moon-rust.jsonl.1"),
            pruned: None,
            dropped: 0,
            issue: String::new(),
            status_written: false,
        }
    }
    fn prune_file(path: &Path, cutoff: OffsetDateTime) -> io::Result<()> {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        let mut retained = String::new();
        let mut expired = false;
        for line in text.lines().filter(|line| !line.is_empty()) {
            let value: Value = serde_json::from_str(line).map_err(io::Error::other)?;
            let timestamp = value
                .get("timestamp")
                .and_then(Value::as_str)
                .ok_or_else(|| io::Error::other("invalid diagnostic timestamp"))?;
            let time = OffsetDateTime::parse(timestamp, &Rfc3339).map_err(io::Error::other)?;
            if time >= cutoff {
                retained.push_str(line);
                retained.push('\n');
            } else {
                expired = true;
            }
        }
        if expired {
            let temporary = path.with_extension("pending");
            fs::write(&temporary, retained)?;
            if let Err(error) = fs::rename(&temporary, path) {
                let _ = fs::remove_file(&temporary);
                return Err(error);
            }
        }
        Ok(())
    }
    fn write_record(&mut self, line: &str) -> io::Result<()> {
        if line.len() + 1 > RECORD_BYTES {
            return Err(io::Error::other("diagnostic record exceeds capacity"));
        }
        fs::create_dir_all(&self.directory)?;
        if self.pruned.is_none_or(|last| {
            last.elapsed()
                .is_ok_and(|age| age >= Duration::from_secs(3600))
        }) {
            let cutoff = OffsetDateTime::now_utc() - time::Duration::days(RETENTION_DAYS);
            Self::prune_file(&self.archive, cutoff)?;
            Self::prune_file(&self.file, cutoff)?;
            self.pruned = Some(SystemTime::now());
        }
        let bytes = match fs::metadata(&self.file) {
            Ok(info) => info.len(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
            Err(error) => return Err(error),
        };
        if bytes + line.len() as u64 + 1 > FILE_BYTES {
            fs::rename(&self.file, &self.archive)?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file)?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        file.flush()
    }
    fn append(&mut self, line: &str) {
        let previous_issue = !self.issue.is_empty();
        match self.write_record(line) {
            Ok(()) => self.issue.clear(),
            Err(error) => {
                self.dropped += 1;
                self.issue = format!(
                    "桌面诊断写入失败（{:?}），丢弃 {} 条。",
                    error.kind(),
                    self.dropped
                );
                self.pruned = None;
                // A failed diagnostic sink must not recurse through log or change a business receipt.
                if !previous_issue {
                    eprintln!("{}", self.issue);
                }
            }
        }
        if !self.status_written || previous_issue || !self.issue.is_empty() {
            let status =
                json!({ "dropped": self.dropped, "issue": self.issue, "timestamp": now() })
                    .to_string();
            let path = self.directory.join("moon-rust-status.json");
            let temporary = self.directory.join("moon-rust-status.pending");
            self.status_written = fs::write(&temporary, status)
                .and_then(|_| fs::rename(&temporary, &path))
                .is_ok();
            if !self.status_written {
                let _ = fs::remove_file(&temporary);
                if !previous_issue {
                    eprintln!("桌面诊断状态文件不可写；请检查数据目录磁盘与权限。");
                }
            }
        }
    }
}

pub fn write_early(directory: &Path, message: &str) -> io::Result<()> {
    let line = json!({ "schemaVersion": 1, "timestamp": now(), "process": format!("moon-rust-{}", std::process::id()),
        "module": "desktop", "event": "startup.failed", "level": "error", "traceId": "", "operationId": "", "outcome": "unknown",
        "error": { "code": "startup_failed", "errorId": "", "cause": message.chars().take(400).collect::<String>() }
    }).to_string();
    Journal::new(&directory.join("early")).write_record(&line)
}

pub fn plugin(directory: PathBuf) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let journal = Mutex::new(Journal::new(&directory));
    tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .clear_format()
        .targets([tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Dispatch(
            fern::Dispatch::new().chain(fern::Output::call(move |record| {
                let line = if record.target() == "moon::terminal" { record.args().to_string() } else {
                    // Lifecycle call sites contain only fixed event/code metadata; no user payload.
                    json!({ "schemaVersion": 1, "timestamp": now(), "process": format!("moon-rust-{}", std::process::id()),
                        "module": "desktop", "event": record.target(), "level": record.level().as_str().to_lowercase(),
                        "traceId": "", "operationId": "", "outcome": "",
                        "error": { "code": "desktop_lifecycle", "errorId": "", "cause": record.args().to_string().chars().take(400).collect::<String>() }
                    }).to_string()
                };
                match journal.lock() {
                    Ok(mut writer) => writer.append(&line),
                    Err(_) => eprintln!("桌面诊断写入器锁损坏，未写入该条记录。"),
                }
            }))
        ))]).build()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!("moon-rust-log-{}", uuid::Uuid::new_v4()))
    }
    fn record(time: OffsetDateTime, event: &str) -> String {
        json!({"schemaVersion": 1, "timestamp": time.format(&Rfc3339).unwrap(), "level": "info", "event": event}).to_string()
    }
    #[test]
    fn retention_and_corruption_are_explicit() {
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let mut writer = Journal::new(&root);
        fs::write(
            &writer.file,
            record(
                OffsetDateTime::now_utc() - time::Duration::days(15),
                "expired",
            ) + "\n",
        )
        .unwrap();
        writer
            .write_record(&record(OffsetDateTime::now_utc(), "current"))
            .unwrap();
        assert!(
            !fs::read_to_string(&writer.file)
                .unwrap()
                .contains("expired")
        );
        fs::write(&writer.file, "broken\n").unwrap();
        writer.pruned = None;
        assert!(
            writer
                .write_record(&record(OffsetDateTime::now_utc(), "not-written"))
                .is_err()
        );
        assert_eq!(fs::read_to_string(&writer.file).unwrap(), "broken\n");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn capacity_rotation_and_failure_recovery() {
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let mut writer = Journal::new(&root);
        let line = record(OffsetDateTime::now_utc(), &"x".repeat(8000));
        assert!(writer.write_record(&"x".repeat(RECORD_BYTES)).is_err());
        for _ in 0..1200 {
            writer.write_record(&line).unwrap();
        }
        assert!(fs::metadata(&writer.file).unwrap().len() <= FILE_BYTES);
        assert!(fs::metadata(&writer.archive).unwrap().len() <= FILE_BYTES);
        fs::remove_dir_all(&root).unwrap();
        fs::write(&root, "blocked").unwrap();
        writer.pruned = None;
        writer.append(&line);
        assert_eq!(writer.dropped, 1);
        assert!(!writer.issue.is_empty());
        fs::remove_file(&root).unwrap();
        writer.append(&line);
        assert!(writer.issue.is_empty());
        assert_eq!(writer.dropped, 1);
        fs::remove_dir_all(root).unwrap();
    }
}
