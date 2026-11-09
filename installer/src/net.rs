//! Downloads over HTTPS with Windows' own WinHTTP: the system's proxy settings and certificates,
//! and no TLS code inside the installer.

use std::ffi::c_void;
use std::fs::File;
use std::io::Write;
use std::path::Path;

use windows::Win32::Networking::WinHttp::{
    URL_COMPONENTS, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2,
    WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3, WINHTTP_OPEN_REQUEST_FLAGS, WINHTTP_OPTION_SECURE_PROTOCOLS, WINHTTP_QUERY_CONTENT_LENGTH,
    WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_FLAG_NUMBER64, WINHTTP_QUERY_STATUS_CODE, WinHttpCloseHandle, WinHttpConnect, WinHttpCrackUrl,
    WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetOption,
    WinHttpSetTimeouts,
};
use windows::core::{HSTRING, PCWSTR};

struct Handle(*mut c_void);

impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: a handle WinHTTP gave us, closed once.
            unsafe {
                let _ = WinHttpCloseHandle(self.0);
            }
        }
    }
}

fn check(h: *mut c_void, what: &str) -> Result<Handle, String> {
    if h.is_null() {
        Err(format!("{what}: {}", windows::core::Error::from_thread().message()))
    } else {
        Ok(Handle(h))
    }
}

/// GETs `url` into `dest`, calling `progress(bytes so far, total if known)` as it goes.
pub fn download(url: &str, dest: &Path, agent: &str, progress: &mut dyn FnMut(u64, Option<u64>)) -> Result<u64, String> {
    let wide: Vec<u16> = url.encode_utf16().collect();
    let mut parts = URL_COMPONENTS {
        dwStructSize: size_of::<URL_COMPONENTS>() as u32,
        dwSchemeLength: u32::MAX,
        dwHostNameLength: u32::MAX,
        dwUrlPathLength: u32::MAX,
        dwExtraInfoLength: u32::MAX,
        ..Default::default()
    };
    // SAFETY: WinHTTP calls with buffers and handles that outlive them; handles close in Drop.
    unsafe {
        WinHttpCrackUrl(&wide, 0, &mut parts).map_err(|e| format!("{url}: {}", e.message()))?;
        let slice = |p: windows::core::PWSTR, n: u32| String::from_utf16_lossy(std::slice::from_raw_parts(p.0, n as usize));
        let host = slice(parts.lpszHostName, parts.dwHostNameLength);
        let path = slice(parts.lpszUrlPath, parts.dwUrlPathLength) + &slice(parts.lpszExtraInfo, parts.dwExtraInfoLength);
        let secure = slice(parts.lpszScheme, parts.dwSchemeLength).eq_ignore_ascii_case("https");

        let session = check(
            WinHttpOpen(
                &HSTRING::from(agent),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            ),
            "WinHttpOpen",
        )?;
        let protocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
        if WinHttpSetOption(Some(session.0), WINHTTP_OPTION_SECURE_PROTOCOLS, Some(&protocols.to_le_bytes())).is_err() {
            // Older Windows 10 without TLS 1.3 in WinHTTP: 1.2 alone.
            let _ = WinHttpSetOption(
                Some(session.0),
                WINHTTP_OPTION_SECURE_PROTOCOLS,
                Some(&WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2.to_le_bytes()),
            );
        }
        let _ = WinHttpSetTimeouts(session.0, 20_000, 20_000, 30_000, 60_000);
        let connect = check(
            WinHttpConnect(session.0, &HSTRING::from(host.as_str()), parts.nPort, 0),
            "WinHttpConnect",
        )?;
        let flags = if secure {
            WINHTTP_FLAG_SECURE
        } else {
            WINHTTP_OPEN_REQUEST_FLAGS(0)
        };
        let request = check(
            WinHttpOpenRequest(
                connect.0,
                &HSTRING::from("GET"),
                &HSTRING::from(path.as_str()),
                PCWSTR::null(),
                PCWSTR::null(),
                std::ptr::null(),
                flags,
            ),
            "WinHttpOpenRequest",
        )?;
        WinHttpSendRequest(request.0, None, None, 0, 0, 0).map_err(|e| format!("{host}: {}", e.message()))?;
        WinHttpReceiveResponse(request.0, std::ptr::null_mut()).map_err(|e| format!("{host}: {}", e.message()))?;

        let mut status = 0u32;
        let mut size = 4u32;
        WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some(&mut status as *mut u32 as *mut c_void),
            &mut size,
            std::ptr::null_mut(),
        )
        .map_err(|e| e.message())?;
        if status != 200 {
            return Err(format!("{url}: HTTP {status}"));
        }
        let mut length = 0u64;
        let mut size = 8u32;
        let total = WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER64,
            PCWSTR::null(),
            Some(&mut length as *mut u64 as *mut c_void),
            &mut size,
            std::ptr::null_mut(),
        )
        .ok()
        .map(|_| length)
        .filter(|&n| n > 0);

        let mut file = File::create(dest).map_err(|e| format!("{}: {e}", dest.display()))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut got = 0u64;
        loop {
            let mut n = 0u32;
            WinHttpReadData(request.0, buf.as_mut_ptr() as *mut c_void, buf.len() as u32, &mut n)
                .map_err(|e| format!("{host}: {}", e.message()))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n as usize]).map_err(|e| format!("{}: {e}", dest.display()))?;
            got += u64::from(n);
            progress(got, total);
        }
        if total.is_some_and(|t| t != got) {
            return Err(format!("{url}: {got} of {} bytes", total.unwrap_or(0)));
        }
        file.flush().map_err(|e| e.to_string())?;
        Ok(got)
    }
}
