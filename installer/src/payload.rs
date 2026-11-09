//! What the installer carries: the whole app as a tar archive compressed with zstd, appended to this
//! program, then an 8-byte offset and the marker "TPSETUP2" (scripts/paket.mjs writes it). zstd at
//! a high level makes the download about a quarter smaller than zip and unpacks in a second or two;
//! the frame's checksum catches a damaged download.

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use ruzstd::decoding::StreamingDecoder;

pub const MARKER: &[u8; 8] = b"TPSETUP2";

pub struct Payload {
    pub exe: PathBuf,
    pub offset: u64,
    pub length: u64,
}

/// This program's payload, if it carries one (the uninstaller does not).
pub fn find() -> Option<Payload> {
    let exe = std::env::current_exe().ok()?;
    let mut file = File::open(&exe).ok()?;
    let size = file.metadata().ok()?.len();
    if size < 16 {
        return None;
    }
    file.seek(SeekFrom::End(-16)).ok()?;
    let mut tail = [0u8; 16];
    file.read_exact(&mut tail).ok()?;
    if &tail[8..] != MARKER {
        return None;
    }
    let offset = u64::from_le_bytes(tail[..8].try_into().ok()?);
    (offset > 0 && offset < size - 16).then(|| Payload {
        exe,
        offset,
        length: size - 16 - offset,
    })
}

/// Counts what is read from the compressed stream: that is the unpacking's progress.
struct Counted<'a, R> {
    inner: R,
    read: u64,
    told: u64,
    total: u64,
    progress: &'a mut dyn FnMut(u64, u64),
}

impl<R: Read> Read for Counted<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        if self.read - self.told >= 1 << 20 || n == 0 {
            self.told = self.read;
            (self.progress)(self.read, self.total);
        }
        Ok(n)
    }
}

impl Payload {
    /// This program without its payload: what is left is the uninstaller.
    pub fn stub(&self) -> io::Result<Vec<u8>> {
        let mut file = File::open(&self.exe)?;
        let mut out = vec![0u8; self.offset as usize];
        file.read_exact(&mut out)?;
        Ok(out)
    }

    /// Unpacks everything into `dest`, calling `progress(compressed bytes read, all of them)`.
    pub fn extract(&self, dest: &Path, progress: &mut dyn FnMut(u64, u64)) -> Result<(), String> {
        let mut file = File::open(&self.exe).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(self.offset)).map_err(|e| e.to_string())?;
        let counted = Counted {
            inner: BufReader::with_capacity(1 << 17, file.take(self.length)),
            read: 0,
            told: 0,
            total: self.length,
            progress,
        };
        let mut zstd = StreamingDecoder::new(counted).map_err(|e| format!("zstd: {e}"))?;
        {
            let mut archive = tar::Archive::new(&mut zstd);
            archive.set_overwrite(true);
            archive.set_preserve_mtime(true);
            archive.unpack(dest).map_err(|e| format!("{}: {e}", dest.display()))?;
        }
        // The rest of the frame (tar's closing blocks), then its checksum.
        io::copy(&mut zstd, &mut io::sink()).map_err(|e| format!("zstd: {e}"))?;
        let frame = &zstd.decoder;
        if let (Some(listed), Some(found)) = (frame.get_checksum_from_data(), frame.get_calculated_checksum())
            && listed != found
        {
            return Err(format!("zstd checksum {found:08x} is not {listed:08x}"));
        }
        Ok(())
    }
}
