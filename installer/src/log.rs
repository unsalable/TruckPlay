//! A plain log of what the installer did: %TEMP%\TruckPlay-kurulum.log, or update.log in the update
//! folder when TruckPlay updates itself.

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::Win32::System::SystemInformation::GetLocalTime;

pub struct Log {
    pub path: PathBuf,
    file: Mutex<Option<File>>,
}

impl Log {
    pub fn create(path: PathBuf) -> Log {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let file = File::create(&path).ok();
        Log {
            path,
            file: Mutex::new(file),
        }
    }

    pub fn line(&self, text: &str) {
        // SAFETY: a plain query of the local time.
        let t = unsafe { GetLocalTime() };
        if let Ok(mut guard) = self.file.lock()
            && let Some(f) = guard.as_mut()
        {
            let _ = writeln!(f, "{:02}:{:02}:{:02}.{:03} {text}", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
            let _ = f.flush();
        }
    }
}

/// Now, in UTC, as ISO 8601 (result.json's "at").
pub fn now_iso() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// `s` as a JSON string, quotes included.
pub fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_strings() {
        assert_eq!(json_string(r#"C:\x "y""#), r#""C:\\x \"y\"""#);
        assert_eq!(json_string("a\nb"), r#""a\nb""#);
    }

    #[test]
    fn iso_time_looks_right() {
        let s = now_iso();
        assert_eq!(s.len(), 20);
        assert!(s.starts_with("20") && s.ends_with('Z'));
    }
}
