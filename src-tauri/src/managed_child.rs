//! Own only explicitly launched plugin children. User browsers/editors are external.
pub fn entry() -> Option<Result<i32, String>> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--moon-managed-child")) {
        return None;
    }
    Some(platform::run(args.collect()))
}

#[cfg(windows)]
mod platform {
    use std::{
        io::{Read, Write},
        os::windows::{io::AsRawHandle, process::CommandExt},
        process::{Command, Stdio},
        sync::mpsc,
        time::Duration,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First,
                Thread32Next,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            },
            Threading::{
                CREATE_NO_WINDOW, CREATE_SUSPENDED, OpenProcess, OpenThread, PROCESS_SYNCHRONIZE,
                ResumeThread, THREAD_SUSPEND_RESUME, WaitForSingleObject,
            },
        },
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    pub fn run(args: Vec<std::ffi::OsString>) -> Result<i32, String> {
        let binary = args.first().ok_or("受管程序缺失。")?;
        let parent_id: u32 = std::env::var("MOON_DESKTOP_PID")
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|id| *id > 0)
            .ok_or("受管程序缺少主机身份。")?;
        let parent = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, parent_id) };
        if parent.is_null() {
            return Err("Moon主机已经退出，未启动插件程序。".into());
        }
        let parent = Handle(parent);
        if unsafe { WaitForSingleObject(parent.0, 0) } == WAIT_OBJECT_0 {
            return Err("Moon主机已经退出。".into());
        }
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err("插件进程回收保护无法建立。".into());
        }
        let job = Handle(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err("插件进程回收保护无法设置。".into());
        }
        // Suspend before any user code can create descendants, assign the job,
        // then resume the actual initial thread. The job handle is not inherited.
        let mut child = Command::new(binary)
            .args(&args[1..])
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED)
            .spawn()
            .map_err(|_| "插件程序未能启动。")?;
        if unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle()) } == 0 {
            let _ = child.kill();
            let _ = child.wait();
            return Err("插件程序未能纳入回收保护，已终止。".into());
        }
        if let Err(error) = resume(child.id()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        println!("MOON_MANAGED_PID={}", child.id());
        std::io::stdout()
            .flush()
            .map_err(|_| "受管程序身份未能传回。")?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut byte = [0];
            let _ = std::io::stdin().read(&mut byte);
            let _ = sender.send(());
        });
        loop {
            if let Some(status) = child.try_wait().map_err(|_| "插件退出状态无法读取。")?
            {
                return Ok(status.code().unwrap_or(1));
            }
            if unsafe { WaitForSingleObject(parent.0, 0) } == WAIT_OBJECT_0
                || receiver.try_recv().is_ok()
            {
                // Drop closes the last job handle, including all descendants.
                drop(job);
                let _ = child.wait();
                return Ok(1);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    fn resume(pid: u32) -> Result<(), String> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("插件启动线程无法核对。".into());
        }
        let snapshot = Handle(snapshot);
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        let mut found = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
        while found {
            if entry.th32OwnerProcessID == pid {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if thread.is_null() {
                    return Err("插件启动线程不可恢复。".into());
                }
                let thread = Handle(thread);
                if unsafe { ResumeThread(thread.0) } == u32::MAX {
                    return Err("插件启动线程恢复失败。".into());
                }
                return Ok(());
            }
            found = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
        }
        Err("插件启动线程已失效。".into())
    }
}
#[cfg(not(windows))]
mod platform {
    pub fn run(_: Vec<std::ffi::OsString>) -> Result<i32, String> {
        Err("当前平台尚未提供插件进程树回收，未启动OpenCLI。".into())
    }
}
