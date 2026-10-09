//! 兼容已安装旧版的2.5.2单实例屏障；必须同时持有mutex与可FindWindow的接收窗口。
#[cfg(windows)]
mod platform {
    use std::{sync::mpsc, thread};
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HWND, LPARAM, LRESULT, WPARAM,
        },
        System::{
            LibraryLoader::GetModuleHandleW,
            RemoteDesktop::{
                ProcessIdToSessionId, WTS_CURRENT_SERVER_HANDLE, WTS_SESSION_INFOW,
                WTSEnumerateSessionsW, WTSFreeMemory, WTSQuerySessionInformationW, WTSUserName,
            },
            Threading::{
                CreateMutexW, GetCurrentProcessId, GetCurrentThreadId, OpenProcess,
                WaitForSingleObject,
            },
        },
        UI::WindowsAndMessaging::*,
    };
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_COPYDATA {
            unsafe {
                ShowWindow(hwnd, SW_SHOW);
                SetForegroundWindow(hwnd);
            }
            return 1;
        }
        if message == WM_CLOSE {
            return 0;
        }
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }
    pub struct Guard {
        pub window: usize,
        thread_id: u32,
        thread: Option<thread::JoinHandle<()>>,
    }
    impl Guard {
        pub fn create(parent_running: bool) -> Result<Self, String> {
            let (sender, receiver) = mpsc::channel();
            let thread = thread::spawn(move || unsafe {
                let mutex =
                    CreateMutexW(std::ptr::null(), 0, wide("local.moon.desktop-sim").as_ptr());
                if mutex.is_null() {
                    let _ = sender.send(Err("无法建立旧版单实例保护。".to_string()));
                    return;
                }
                if !parent_running && GetLastError() == ERROR_ALREADY_EXISTS {
                    CloseHandle(mutex);
                    let _ =
                        sender.send(Err("旧版Moon仍在运行，请完全退出旧版后重试。".to_string()));
                    return;
                }
                let class_name = wide("local.moon.desktop-sic");
                let title = wide("local.moon.desktop-siw");
                let instance = GetModuleHandleW(std::ptr::null());
                let mut class: WNDCLASSW = std::mem::zeroed();
                class.lpfnWndProc = Some(window_proc);
                class.hInstance = instance;
                class.lpszClassName = class_name.as_ptr();
                if RegisterClassW(&class) == 0 {
                    CloseHandle(mutex);
                    let _ = sender.send(Err("维护消息窗口无法注册。".into()));
                    return;
                }
                let window = CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    title.as_ptr(),
                    WS_OVERLAPPED | WS_CAPTION,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    580,
                    130,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                if window.is_null() {
                    CloseHandle(mutex);
                    let _ = sender.send(Err("维护消息窗口无法创建。".into()));
                    return;
                }
                // 旧插件以固定title查找；用户进度使用子控件，不能改掉屏障窗口title。
                CreateWindowExW(
                    0,
                    wide("STATIC").as_ptr(),
                    wide("Moon正在维护数据，请等待完成后重新打开。原数据会保留。").as_ptr(),
                    WS_CHILD | WS_VISIBLE,
                    20,
                    25,
                    530,
                    50,
                    window,
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                let _ = sender.send(Ok((window as usize, GetCurrentThreadId())));
                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                DestroyWindow(window);
                UnregisterClassW(class_name.as_ptr(), instance);
                CloseHandle(mutex);
            });
            let (window, thread_id) = receiver.recv().map_err(|_| "维护屏障创建失败。")??;
            Ok(Self {
                window,
                thread_id,
                thread: Some(thread),
            })
        }
        pub fn show(&self) {
            unsafe {
                ShowWindow(self.window as HWND, SW_SHOW);
            }
        }
    }
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
            }
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
    pub fn wait_parent(pid: u32) -> Result<(), String> {
        unsafe {
            let handle = OpenProcess(0x00100000, 0, pid);
            if handle.is_null() {
                return if GetLastError() == 87 {
                    Ok(())
                } else {
                    Err("无法证明原Moon进程已退出，请检查权限；未复制profile。".into())
                };
            }
            let result = WaitForSingleObject(handle, 60_000);
            CloseHandle(handle);
            if result != 0 {
                return Err("原Moon进程尚未退出，未复制profile；请退出后重试。".into());
            }
        }
        Ok(())
    }
    unsafe fn username(session: u32) -> Option<String> {
        let mut buffer = std::ptr::null_mut();
        let mut bytes = 0;
        if unsafe {
            WTSQuerySessionInformationW(
                WTS_CURRENT_SERVER_HANDLE,
                session,
                WTSUserName,
                &mut buffer,
                &mut bytes,
            )
        } == 0
        {
            return None;
        }
        let result = if bytes > 2 {
            Some(String::from_utf16_lossy(unsafe {
                std::slice::from_raw_parts(buffer, (bytes / 2 - 1) as usize)
            }))
        } else {
            Some(String::new())
        };
        unsafe {
            WTSFreeMemory(buffer.cast());
        }
        result
    }
    pub fn require_single_user_session() -> Result<(), String> {
        unsafe {
            let mut current = 0;
            if ProcessIdToSessionId(GetCurrentProcessId(), &mut current) == 0 {
                return Err("无法核对当前Windows登录会话。".into());
            }
            let user = username(current).ok_or("无法核对当前Windows用户。")?;
            if user.is_empty() {
                return Err("当前Windows用户身份为空，不能导入旧数据。".into());
            }
            let mut sessions: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
            let mut count = 0;
            if WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &mut sessions, &mut count)
                == 0
            {
                return Err("无法确认旧版导入的单登录会话前提。".into());
            }
            let mut others = false;
            let mut unverifiable = false;
            for session in std::slice::from_raw_parts(sessions, count as usize) {
                if session.SessionId != current {
                    match username(session.SessionId) {
                        Some(value) => {
                            others |= !value.is_empty() && value.eq_ignore_ascii_case(&user)
                        }
                        None => unverifiable = true,
                    }
                }
            }
            WTSFreeMemory(sessions.cast());
            if unverifiable {
                return Err("无法核对其他Windows登录会话，未开始旧数据复制。".into());
            }
            if others {
                return Err(
                    "同一用户还有其他Windows登录会话，请退出其他会话后导入旧版数据。".into(),
                );
            }
        }
        Ok(())
    }
    pub fn progress(message: &str) {
        unsafe {
            let window = FindWindowW(
                wide("local.moon.desktop-sic").as_ptr(),
                wide("local.moon.desktop-siw").as_ptr(),
            );
            if !window.is_null() {
                let label = GetWindow(window, GW_CHILD);
                if !label.is_null() {
                    SetWindowTextW(label, wide(message).as_ptr());
                }
            }
        }
    }
    pub fn notify_existing() -> bool {
        #[repr(C)]
        struct CopyData {
            data: usize,
            bytes: u32,
            pointer: *const std::ffi::c_void,
        }
        unsafe {
            let window = FindWindowW(
                wide("local.moon.desktop-sic").as_ptr(),
                wide("local.moon.desktop-siw").as_ptr(),
            );
            if window.is_null() {
                return false;
            }
            let payload = b"moon|moon\0";
            let data = CopyData {
                data: 1542,
                bytes: payload.len() as u32,
                pointer: payload.as_ptr().cast(),
            };
            let mut result = 0;
            SendMessageTimeoutW(
                window,
                WM_COPYDATA,
                0,
                &data as *const _ as isize,
                SMTO_ABORTIFHUNG,
                1500,
                &mut result,
            );
            true
        }
    }
}
#[cfg(windows)]
pub use platform::*;
#[cfg(not(windows))]
pub struct Guard;
#[cfg(not(windows))]
impl Guard {
    pub fn create(_: bool) -> Result<Self, String> {
        Err("首期离线迁移只支持Windows。".into())
    }
    pub fn show(&self) {}
}
#[cfg(not(windows))]
pub fn wait_parent(_: u32) -> Result<(), String> {
    Ok(())
}
#[cfg(not(windows))]
pub fn require_single_user_session() -> Result<(), String> {
    Err("旧版导入只支持Windows。".into())
}
#[cfg(not(windows))]
pub fn notify_existing() -> bool {
    false
}
#[cfg(not(windows))]
pub fn progress(_: &str) {}
