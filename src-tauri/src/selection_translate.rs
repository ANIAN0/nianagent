use crate::translation_text::{self, wide};
use std::{
    ptr::{null, null_mut},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
};
use windows::Win32::System::Ole::{OleInitialize, OleUninitialize};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

const RESULT: u32 = WM_APP + 70;

type ControlJob = (bool, Box<dyn FnOnce(Result<(), String>) + Send>);

pub struct Controller {
    tx: Option<mpsc::Sender<ControlJob>>,
}
impl Controller {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<ControlJob>();
        let _ = thread::Builder::new()
            .name("moon-selection-ctl".into())
            .spawn(move || {
                let mut listener = Listener::default();
                while let Ok((enabled, reply)) = rx.recv() {
                    reply(listener.configure(enabled));
                }
            });
        Self { tx: Some(tx) }
    }
    pub fn configure(
        &self,
        enabled: bool,
        reply: impl FnOnce(Result<(), String>) + Send + 'static,
    ) {
        if let Some(tx) = &self.tx {
            if let Err(err) = tx.send((enabled, Box::new(reply))) {
                (err.0.1)(Err("划词控制线程已退出。".into()));
            }
        } else {
            reply(Err("划词控制线程未就绪。".into()));
        }
    }
}
impl Drop for Controller {
    fn drop(&mut self) {
        self.tx.take();
    }
}

#[derive(Default)]
pub struct Listener {
    worker: Option<(u32, thread::JoinHandle<()>)>,
}
impl Listener {
    pub fn configure(&mut self, enabled: bool) -> Result<(), String> {
        if enabled && self.worker.is_none() {
            let (tx, rx) = mpsc::sync_channel(1);
            let worker = thread::Builder::new()
                .name("moon-selection".into())
                .spawn(move || run(tx))
                .map_err(|_| "无法创建快捷键线程。")?;
            let id = rx.recv().map_err(|_| "划词窗口初始化失败。")??;
            self.worker = Some((id, worker));
        } else if !enabled && let Some((id, worker)) = self.worker.take() {
            unsafe {
                PostThreadMessageW(id, WM_QUIT, 0, 0);
            }
            worker.join().map_err(|_| "快捷键线程退出异常。")?;
        }
        Ok(())
    }
}
impl Drop for Listener {
    fn drop(&mut self) {
        let _ = self.configure(false);
    }
}

unsafe extern "system" fn popup_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if msg == WM_CLOSE {
        unsafe {
            ShowWindow(hwnd, SW_HIDE);
        }
        return 0;
    }
    unsafe { DefWindowProcW(hwnd, msg, w, l) }
}
fn dpi_scale(hwnd: HWND, value: i32) -> i32 {
    unsafe {
        let hdc = GetDC(hwnd);
        let dpi = if hdc.is_null() {
            96
        } else {
            let d = GetDeviceCaps(hdc, LOGPIXELSX as i32);
            ReleaseDC(hwnd, hdc);
            if d > 0 { d } else { 96 }
        };
        (value * dpi + 48) / 96
    }
}

struct Popup {
    window: HWND,
    edit: HWND,
    font: HFONT,
}
impl Popup {
    fn new() -> Result<Self, String> {
        unsafe {
            let class = wide("MoonSelectionTranslation");
            let instance = GetModuleHandleW(null());
            let wc = WNDCLASSW {
                lpfnWndProc: Some(popup_proc),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                hCursor: LoadCursorW(null_mut(), IDC_ARROW),
                hbrBackground: (COLOR_WINDOW + 1) as _,
                ..Default::default()
            };
            if RegisterClassW(&wc) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS {
                return Err("无法注册译文窗口。".into());
            }
            let window = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                class.as_ptr(),
                wide("Moon · 划词翻译").as_ptr(),
                WS_POPUPWINDOW | WS_CAPTION,
                0,
                0,
                400,
                180,
                null_mut(),
                null_mut(),
                instance,
                null(),
            );
            if window.is_null() {
                return Err("无法创建译文窗口。".into());
            }
            let edit = CreateWindowExW(
                0,
                wide("EDIT").as_ptr(),
                null(),
                WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE as u32 | ES_READONLY as u32,
                10,
                8,
                360,
                132,
                window,
                null_mut(),
                instance,
                null(),
            );
            if edit.is_null() {
                DestroyWindow(window);
                return Err("无法创建译文文本框。".into());
            }
            let font = CreateFontW(
                -dpi_scale(window, 16),
                0,
                0,
                0,
                FW_NORMAL as i32,
                0,
                0,
                0,
                DEFAULT_CHARSET as u32,
                0,
                0,
                CLEARTYPE_QUALITY as u32,
                0,
                wide("Microsoft YaHei UI").as_ptr(),
            );
            SendMessageW(edit, WM_SETFONT, font as usize, 1);
            Ok(Self { window, edit, font })
        }
    }
    fn text(&self, text: &str) {
        unsafe {
            SetWindowTextW(
                self.edit,
                wide(&text.replace("\r\n", "\n").replace('\n', "\r\n")).as_ptr(),
            );
        }
    }
    fn show(&self, text: &str) {
        self.text(text);
        unsafe {
            let mut cursor = POINT::default();
            GetCursorPos(&mut cursor);
            let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(monitor, &mut info);
            let rect = info.rcWork;
            let w = dpi_scale(self.window, 420).min((rect.right - rect.left).max(1));
            let h = dpi_scale(self.window, 190).min((rect.bottom - rect.top).max(1));
            let offset_x = dpi_scale(self.window, 12);
            let offset_y = dpi_scale(self.window, 18);
            let x = (cursor.x + offset_x).clamp(rect.left, rect.right.max(rect.left + w) - w);
            let y = (cursor.y + offset_y).clamp(rect.top, rect.bottom.max(rect.top + h) - h);
            SetWindowPos(
                self.window,
                HWND_TOPMOST,
                x,
                y,
                w,
                h,
                SWP_SHOWWINDOW | SWP_NOACTIVATE,
            );
            let pad_x = dpi_scale(self.window, 12);
            let pad_y = dpi_scale(self.window, 10);
            let mut client = RECT::default();
            GetClientRect(self.window, &mut client);
            MoveWindow(
                self.edit,
                pad_x,
                pad_y,
                (client.right - pad_x * 2).max(1),
                (client.bottom - pad_y * 2).max(1),
                1,
            );
        }
    }
}
impl Drop for Popup {
    fn drop(&mut self) {
        unsafe {
            DestroyWindow(self.window);
            DeleteObject(self.font);
        }
    }
}

fn run(ready: mpsc::SyncSender<Result<u32, String>>) {
    if unsafe { OleInitialize(None) }.is_err() {
        let _ = ready.send(Err("无法初始化系统取词接口。".into()));
        return;
    }
    let result = event_loop(&ready);
    if let Err(error) = result {
        let _ = ready.send(Err(error));
    }
    unsafe {
        OleUninitialize();
    }
}
fn event_loop(ready: &mpsc::SyncSender<Result<u32, String>>) -> Result<(), String> {
    let popup = Popup::new()?;
    let thread_id = unsafe { GetCurrentThreadId() };
    if unsafe { RegisterHotKey(null_mut(), 1, MOD_ALT | MOD_NOREPEAT, u32::from(b'1')) } == 0 {
        return Err("无法注册 Alt+1。请释放其他应用占用的快捷键后重新启用。".into());
    }
    let (jobs, requests) = mpsc::channel::<(u64, String)>();
    let (results, updates) = mpsc::channel();
    let current = Arc::new(AtomicU64::new(0));
    let alive = Arc::new(AtomicBool::new(true));
    let latest = current.clone();
    let worker_alive = alive.clone();
    // One request in flight. Rapid selections supersede older queued text.
    thread::spawn(move || {
        while let Ok((id, text)) = requests.recv() {
            if !worker_alive.load(Ordering::Acquire) || latest.load(Ordering::Acquire) != id {
                continue;
            }
            let answer = translation_text::translate(&text).unwrap_or_else(|e| e);
            if worker_alive.load(Ordering::Acquire)
                && latest.load(Ordering::Acquire) == id
                && results.send((id, answer)).is_ok()
            {
                unsafe {
                    PostThreadMessageW(thread_id, RESULT, 0, 0);
                }
            }
        }
    });
    if ready.send(Ok(thread_id)).is_ok() {
        let mut msg = MSG::default();
        while unsafe { GetMessageW(&mut msg, null_mut(), 0, 0) } > 0 {
            match msg.message {
                WM_HOTKEY if msg.wParam == 1 => {
                    let id = current.fetch_add(1, Ordering::AcqRel) + 1;
                    match translation_text::selection(popup.window) {
                        Ok(text) => {
                            popup.show("正在翻译…");
                            let _ = jobs.send((id, text));
                        }
                        Err(error) => popup.show(&error),
                    }
                }
                RESULT => {
                    for (id, text) in updates.try_iter() {
                        if id == current.load(Ordering::Acquire) {
                            popup.text(&text);
                        }
                    }
                }
                WM_KEYDOWN if msg.wParam == VK_ESCAPE as usize => unsafe {
                    ShowWindow(popup.window, SW_HIDE);
                },
                _ => unsafe {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                },
            }
        }
    }
    alive.store(false, Ordering::Release);
    current.fetch_add(1, Ordering::AcqRel);
    unsafe {
        UnregisterHotKey(null_mut(), 1);
    }
    Ok(())
}
