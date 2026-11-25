use serde_json::Value;
use std::{
    ffi::c_void,
    ptr::{null, null_mut},
    thread,
    time::{Duration, Instant},
};
use windows::Win32::{
    System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance},
    UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
    },
};
use windows_sys::Win32::{
    Foundation::{GlobalFree, HWND},
    Graphics::Gdi::DeleteObject,
    Networking::WinInet::*,
    System::{DataExchange::*, Memory::*},
    UI::{
        Input::KeyboardAndMouse::*,
        WindowsAndMessaging::{
            CopyImage, GetForegroundWindow, GetWindowThreadProcessId, IMAGE_BITMAP,
            LR_CREATEDIBSECTION,
        },
    },
};

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

const LIMIT: usize = 1500;
fn accessible_selection() -> windows::core::Result<Option<String>> {
    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        let element = automation.GetFocusedElement()?;
        if element.CurrentIsPassword()?.as_bool() {
            return Ok(None);
        }
        let pattern: IUIAutomationTextPattern = element.GetCurrentPatternAs(UIA_TextPatternId)?;
        let ranges = pattern.GetSelection()?;
        let mut text = String::new();
        for index in 0..ranges.Length()? {
            text.push_str(
                &ranges
                    .GetElement(index)?
                    .GetText((LIMIT * 2 + 1) as i32)?
                    .to_string(),
            );
            if text.chars().count() > LIMIT {
                break;
            }
        }
        Ok(Some(text))
    }
}

struct Clipboard;
impl Clipboard {
    fn open(owner: HWND) -> Result<Self, String> {
        for _ in 0..6 {
            if unsafe { OpenClipboard(owner) } != 0 {
                return Ok(Self);
            }
            thread::sleep(Duration::from_millis(10));
        }
        Err("剪贴板正忙，请重试。".into())
    }
}
impl Drop for Clipboard {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}

struct Block(*mut c_void, u32);
impl Drop for Block {
    fn drop(&mut self) {
        if self.0.is_null() {
            return;
        }
        unsafe {
            if self.1 == 2 {
                DeleteObject(self.0);
            } else {
                GlobalFree(self.0);
            }
        }
    }
}

// Duplicate supported formats before sending Ctrl+C, so a failed allocation never
// leaves the original clipboard empty. Non-text handles cannot be copied as bytes.
fn backup() -> Result<Vec<(u32, Block)>, String> {
    let mut saved = Vec::new();
    let mut format = 0;
    unsafe {
        loop {
            format = EnumClipboardFormats(format);
            if format == 0 {
                return Ok(saved);
            }
            let handle = GetClipboardData(format);
            if handle.is_null() {
                continue;
            }
            // CF_BITMAP is a GDI object. Registered formats (including HTML/RTF)
            // and the listed standard formats carry global memory handles.
            if format == 2 {
                let image = CopyImage(handle, IMAGE_BITMAP, 0, 0, LR_CREATEDIBSECTION);
                if image.is_null() {
                    return Err("无法暂存剪贴板图片。".into());
                }
                saved.push((format, Block(image, format)));
                continue;
            }
            if !matches!(format, 1 | 7 | 8 | 13 | 15 | 16 | 17 | 0xc000..=0xffff) {
                return Err("此应用未提供可读取的选区，已保留剪贴板中的特殊格式。".into());
            }
            let size = GlobalSize(handle);
            if size == 0 || size > 32 * 1024 * 1024 {
                return Err("当前剪贴板内容无法安全暂存。".into());
            }
            let raw_block = GlobalAlloc(GMEM_MOVEABLE, size);
            if raw_block.is_null() {
                return Err("剪贴板暂存失败。".into());
            }
            let block = Block(raw_block, format);
            let dst = GlobalLock(block.0);
            if dst.is_null() {
                return Err("剪贴板暂存失败。".into());
            }
            let src = GlobalLock(handle);
            if !src.is_null() {
                std::ptr::copy_nonoverlapping(src.cast::<u8>(), dst.cast::<u8>(), size);
                GlobalUnlock(handle);
            }
            GlobalUnlock(block.0);
            if src.is_null() {
                return Err("当前剪贴板内容无法读取。".into());
            }
            saved.push((format, block));
        }
    }
}
fn restore_clipboard(saved: Vec<(u32, Block)>) -> Result<(), String> {
    unsafe {
        if EmptyClipboard() == 0 {
            return Err("无法恢复原剪贴板。".into());
        }
        let mut failed = false;
        for (format, block) in saved {
            if SetClipboardData(format, block.0).is_null() {
                failed = true;
            } else {
                std::mem::forget(block);
            }
        }
        if failed {
            Err("部分剪贴板格式恢复失败。".into())
        } else {
            Ok(())
        }
    }
}
fn copied_text() -> String {
    unsafe {
        let h = GetClipboardData(13);
        if h.is_null() {
            return String::new();
        }
        let p = GlobalLock(h).cast::<u16>();
        if p.is_null() {
            return String::new();
        }
        let bytes = std::slice::from_raw_parts(p, (GlobalSize(h) / 2).min(2 * LIMIT + 2));
        let text = String::from_utf16_lossy(
            &bytes[..bytes.iter().position(|c| *c == 0).unwrap_or(bytes.len())],
        );
        GlobalUnlock(h);
        text
    }
}
fn copy_selection(owner: HWND, front: HWND) -> Result<String, String> {
    unsafe {
        let until = Instant::now() + Duration::from_millis(700);
        while GetAsyncKeyState(VK_MENU as i32) < 0 && Instant::now() < until {
            thread::sleep(Duration::from_millis(12));
        }
        if GetForegroundWindow() != front || GetAsyncKeyState(VK_MENU as i32) < 0 {
            return Err("请松开 Alt 后重试。".into());
        }
        let (saved, before) = {
            let _open = Clipboard::open(owner)?;
            (backup()?, GetClipboardSequenceNumber())
        };
        let keys = [
            (VK_CONTROL, 0),
            (0x43, 0),
            (0x43, KEYEVENTF_KEYUP),
            (VK_CONTROL, KEYEVENTF_KEYUP),
        ]
        .map(|(key, flags)| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        });
        if SendInput(4, keys.as_ptr(), size_of::<INPUT>() as i32) != 4 {
            return Err("此应用未允许读取选区。".into());
        }
        let until = Instant::now() + Duration::from_millis(700);
        while GetClipboardSequenceNumber() == before {
            if Instant::now() >= until {
                return Err("请先选中文字，再按 Alt+1。".into());
            }
            thread::sleep(Duration::from_millis(12));
        }
        let _open = Clipboard::open(owner)?;
        let mut front_pid = 0;
        let mut clipboard_pid = 0;
        GetWindowThreadProcessId(front, &mut front_pid);
        GetWindowThreadProcessId(GetClipboardOwner(), &mut clipboard_pid);
        if clipboard_pid != front_pid || GetForegroundWindow() != front {
            return Err("前台应用或剪贴板已变化，请重新选词。".into());
        }
        let text = copied_text();
        restore_clipboard(saved)?;
        Ok(text)
    }
}

pub fn selection(owner: HWND) -> Result<String, String> {
    let front = unsafe { GetForegroundWindow() };
    let text = match accessible_selection() {
        Ok(None) => return Err("密码输入框不支持划词。".into()),
        Ok(Some(text)) if !text.trim().is_empty() => text,
        _ => copy_selection(owner, front)?,
    };
    let text = text.trim();
    if text.is_empty() {
        return Err("请先选中文字，再按 Alt+1。".into());
    }
    if text.chars().count() > LIMIT {
        return Err(format!("一次最多翻译 {LIMIT} 个字符，请缩小选区。"));
    }
    Ok(text.to_owned())
}

struct Internet(*mut c_void);
impl Drop for Internet {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                InternetCloseHandle(self.0);
            }
        }
    }
}
pub fn translate(text: &str) -> Result<String, String> {
    let chinese = text.chars().any(
        |c| matches!(c,'\u{3400}'..='\u{9fff}'|'\u{f900}'..='\u{faff}'|'\u{20000}'..='\u{323af}'),
    );
    let (from, to) = if chinese {
        ("zh-CN", "en")
    } else {
        ("en", "zh-CN")
    };
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([("sl", from), ("tl", to), ("q", text)])
        .finish();
    let problem = || "无法连接 Google 翻译，请检查网络后重新按 Alt+1。".to_string();
    unsafe {
        let session = Internet(InternetOpenW(
            wide("Moon").as_ptr(),
            INTERNET_OPEN_TYPE_PRECONFIG,
            null(),
            null(),
            0,
        ));
        if session.0.is_null() {
            return Err(problem());
        }
        let timeout = 6500u32;
        for option in [
            INTERNET_OPTION_CONNECT_TIMEOUT,
            INTERNET_OPTION_SEND_TIMEOUT,
            INTERNET_OPTION_RECEIVE_TIMEOUT,
        ] {
            InternetSetOptionW(session.0, option, (&timeout as *const u32).cast(), 4);
        }
        let connect = Internet(InternetConnectW(
            session.0,
            wide("translate.google.com").as_ptr(),
            443,
            null(),
            null(),
            INTERNET_SERVICE_HTTP,
            0,
            0,
        ));
        if connect.0.is_null() {
            return Err(problem());
        }
        let request = Internet(HttpOpenRequestW(
            connect.0,
            wide("POST").as_ptr(),
            wide("/translate_a/single?client=gtx&dt=t").as_ptr(),
            null(),
            null(),
            null_mut(),
            INTERNET_FLAG_SECURE
                | INTERNET_FLAG_NO_COOKIES
                | INTERNET_FLAG_NO_CACHE_WRITE
                | INTERNET_FLAG_RELOAD
                | INTERNET_FLAG_NO_UI
                | INTERNET_FLAG_NO_AUTO_REDIRECT,
            0,
        ));
        if request.0.is_null() {
            return Err(problem());
        }
        let headers = wide("Content-Type: application/x-www-form-urlencoded; charset=utf-8\r\n");
        if HttpSendRequestW(
            request.0,
            headers.as_ptr(),
            (headers.len() - 1) as u32,
            body.as_ptr().cast_mut().cast(),
            body.len() as u32,
        ) == 0
        {
            return Err(problem());
        }
        let mut status = 0u32;
        let mut size = 4;
        if HttpQueryInfoW(
            request.0,
            HTTP_QUERY_STATUS_CODE | HTTP_QUERY_FLAG_NUMBER,
            (&mut status as *mut u32).cast(),
            &mut size,
            null_mut(),
        ) == 0
        {
            return Err(problem());
        }
        if status != 200 {
            return Err(format!("Google 翻译返回 HTTP {status}，请稍后重试。"));
        }
        let mut data = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let mut count = 0;
            if InternetReadFile(
                request.0,
                buf.as_mut_ptr().cast(),
                buf.len() as u32,
                &mut count,
            ) == 0
            {
                return Err(problem());
            }
            if count == 0 {
                break;
            }
            data.extend_from_slice(&buf[..count as usize]);
            if data.len() > 512 * 1024 {
                return Err("翻译响应过大。".into());
            }
        }
        let json: Value =
            serde_json::from_slice(&data).map_err(|_| "Google 翻译响应格式已变化。")?;
        let result: String = json[0]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|segment| segment[0].as_str())
            .collect();
        if result.trim().is_empty() {
            return Err("Google 未返回译文，请重新选词。".into());
        }
        Ok(result)
    }
}
