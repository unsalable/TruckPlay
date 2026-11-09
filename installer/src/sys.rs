//! The parts of Windows the installer needs: known folders, processes, the registry, shortcuts, a
//! file's real place on disk, the folder picker and opening a link.

use std::ffi::{OsString, c_void};
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HWND};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, GetFinalPathNameByHandleW, MOVEFILE_DELAY_UNTIL_REBOOT, MoveFileExW, OPEN_EXISTING,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, IPersistFile,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ, RegCloseKey,
    RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, QueryFullProcessImageNameW,
    TerminateProcess, WaitForSingleObject,
};
use windows::Win32::UI::Shell::{
    FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, FileOpenDialog, IFileOpenDialog, IShellLinkW, KF_FLAG_DEFAULT,
    SHGetKnownFolderPath, SIGDN_FILESYSPATH, ShellExecuteW, ShellLink,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{GUID, HSTRING, Interface, PCWSTR, PWSTR, w};

fn h(path: &Path) -> HSTRING {
    HSTRING::from(path.as_os_str())
}

// ---------- folders ----------

/// A shell folder (Documents, Desktop, …), wherever the player has moved it (OneDrive included).
pub fn known_folder(id: &GUID) -> Option<PathBuf> {
    // SAFETY: the returned string is the shell's, freed below.
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let path = PathBuf::from(OsString::from_wide(p.as_wide()));
        CoTaskMemFree(Some(p.0 as *const c_void));
        Some(path)
    }
}

/// Where a file really is on disk. A program started from inside an app package (a Microsoft
/// Store app, say) has its writes under AppData moved into the package's own storage; the game,
/// outside it, needs the real path.
pub fn real_path(path: &Path) -> PathBuf {
    // SAFETY: the handle is closed before returning; the buffer is ours.
    unsafe {
        let Ok(handle) = CreateFileW(
            &h(path),
            FILE_READ_ATTRIBUTES.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        ) else {
            return path.to_path_buf();
        };
        let mut buf = vec![0u16; 1024];
        let n = GetFinalPathNameByHandleW(handle, &mut buf, FILE_NAME_NORMALIZED) as usize;
        let _ = CloseHandle(handle);
        if n == 0 || n >= buf.len() {
            return path.to_path_buf();
        }
        let s = String::from_utf16_lossy(&buf[..n]);
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s))
    }
}

/// Removes a file at the next restart (the uninstaller's own copy in %TEMP%). Needs rights the
/// player may not have; then the copy simply stays in %TEMP%.
pub fn delete_at_restart(path: &Path) {
    // SAFETY: plain call with a valid string.
    unsafe {
        let _ = MoveFileExW(&h(path), PCWSTR::null(), MOVEFILE_DELAY_UNTIL_REBOOT);
    }
}

// ---------- processes ----------

pub struct Proc {
    pub pid: u32,
    pub name: String,
}

pub fn processes() -> Vec<Proc> {
    let mut out = Vec::new();
    // SAFETY: the snapshot handle is closed at the end; the entry is sized as the API wants.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut e = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                out.push(Proc {
                    pid: e.th32ProcessID,
                    name: String::from_utf16_lossy(&e.szExeFile[..len]),
                });
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

pub fn process_path(pid: u32) -> Option<PathBuf> {
    // SAFETY: the handle is closed before returning.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size).is_ok();
        let _ = CloseHandle(handle);
        ok.then(|| PathBuf::from(OsString::from_wide(&buf[..size as usize])))
    }
}

fn matching(names: &[&str], within: Option<&Path>) -> Vec<u32> {
    processes()
        .into_iter()
        .filter(|p| names.iter().any(|n| p.name.eq_ignore_ascii_case(n)))
        .filter(|p| match within {
            None => true,
            Some(dir) => process_path(p.pid).is_some_and(|path| path.starts_with(dir)),
        })
        .map(|p| p.pid)
        .collect()
}

pub fn running(names: &[&str], within: Option<&Path>) -> bool {
    !matching(names, within).is_empty()
}

/// Waits up to `timeout` for these processes to end by themselves. True when they have.
pub fn wait_gone(names: &[&str], within: Option<&Path>, timeout: Duration) -> bool {
    let until = Instant::now() + timeout;
    while running(names, within) {
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    true
}

/// Ends these processes (only those started from inside `within`, if given). How many it ended.
pub fn stop(names: &[&str], within: Option<&Path>) -> usize {
    let mut n = 0;
    for pid in matching(names, within) {
        // SAFETY: the handle is closed after the wait.
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, pid) else {
                continue;
            };
            if TerminateProcess(handle, 1).is_ok() {
                n += 1;
                WaitForSingleObject(handle, 4000);
            }
            let _ = CloseHandle(handle);
        }
    }
    n
}

// ---------- registry ----------

/// A key under HKEY_CURRENT_USER, opened for writing (created if missing).
pub struct Key(HKEY);

impl Key {
    pub fn create(path: &str) -> Option<Key> {
        let mut key = HKEY::default();
        // SAFETY: `key` receives the opened key, closed in Drop.
        let err = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(path),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut key,
                None,
            )
        };
        (err == ERROR_SUCCESS).then_some(Key(key))
    }

    pub fn set_str(&self, name: &str, value: &str) -> bool {
        let wide: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        // SAFETY: the bytes are the UTF-16 string with its terminator, as REG_SZ wants.
        let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2) };
        unsafe { RegSetValueExW(self.0, &HSTRING::from(name), None, REG_SZ, Some(bytes)) == ERROR_SUCCESS }
    }

    pub fn set_dword(&self, name: &str, value: u32) -> bool {
        // SAFETY: four bytes of a u32, as REG_DWORD wants.
        unsafe { RegSetValueExW(self.0, &HSTRING::from(name), None, REG_DWORD, Some(&value.to_le_bytes())) == ERROR_SUCCESS }
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the key was opened by RegCreateKeyExW.
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn get_str(root: HKEY, path: &str, name: &str) -> Option<String> {
    let mut buf = vec![0u16; 2048];
    let mut size = (buf.len() * 2) as u32;
    // SAFETY: `buf` holds `size` bytes.
    let err = unsafe {
        RegGetValueW(
            root,
            &HSTRING::from(path),
            &HSTRING::from(name),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut c_void),
            Some(&mut size),
        )
    };
    if err != ERROR_SUCCESS {
        return None;
    }
    let len = (size as usize / 2).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..len.min(buf.len())]))
}

/// Removes a key under HKEY_CURRENT_USER with everything in it.
pub fn delete_key(path: &str) {
    // SAFETY: plain call with a valid string.
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(path));
    }
}

/// Where Steam is installed: the player's own record first, then the machine's.
pub fn steam_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = get_str(HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath") {
        out.push(PathBuf::from(p));
    }
    for key in [r"SOFTWARE\WOW6432Node\Valve\Steam", r"SOFTWARE\Valve\Steam"] {
        if let Some(p) = get_str(HKEY_LOCAL_MACHINE, key, "InstallPath") {
            out.push(PathBuf::from(p));
        }
    }
    out
}

// ---------- COM: shortcuts, folder picker ----------

/// COM for this thread while it lives (shortcuts and the folder picker need it).
pub struct Com;

impl Com {
    pub fn init() -> Com {
        // SAFETY: paired with CoUninitialize in Drop.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        }
        Com
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        // SAFETY: paired with CoInitializeEx.
        unsafe { CoUninitialize() }
    }
}

/// A .lnk at `link` that starts `target` with `args`, with `icon`'s first icon.
pub fn shortcut(link: &Path, target: &Path, args: &str, description: &str, icon: &Path) -> windows::core::Result<()> {
    // SAFETY: COM calls on interfaces we created; the thread has COM (Com::init).
    unsafe {
        let sl: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        sl.SetPath(&h(target))?;
        sl.SetArguments(&HSTRING::from(args))?;
        if let Some(dir) = target.parent() {
            sl.SetWorkingDirectory(&h(dir))?;
        }
        sl.SetIconLocation(&h(icon), 0)?;
        sl.SetDescription(&HSTRING::from(description))?;
        let file: IPersistFile = sl.cast()?;
        file.Save(&h(link), true)?;
    }
    Ok(())
}

/// Windows' own folder picker. None when the player cancels.
pub fn pick_folder(owner: HWND, title: &str) -> Option<PathBuf> {
    // SAFETY: COM calls on interfaces we created; the shell string is freed below.
    unsafe {
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
        let options = dialog.GetOptions().ok()?;
        dialog
            .SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)
            .ok()?;
        dialog.SetTitle(&HSTRING::from(title)).ok()?;
        dialog.Show(Some(owner)).ok()?;
        let item = dialog.GetResult().ok()?;
        let name = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let path = PathBuf::from(OsString::from_wide(name.as_wide()));
        CoTaskMemFree(Some(name.0 as *const c_void));
        Some(path)
    }
}

/// Opens a link the way Explorer would (steam://… starts the game through Steam).
pub fn open(url: &str) {
    // SAFETY: plain call with valid strings.
    unsafe {
        ShellExecuteW(None, w!("open"), &HSTRING::from(url), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
    }
}
