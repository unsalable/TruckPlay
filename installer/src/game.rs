//! Finding Euro Truck Simulator 2: the folder given, else Steam's libraries.

use std::path::{Path, PathBuf};

use crate::sys;

pub const GAME_EXE: &str = "eurotrucks2.exe";

pub fn is_game(dir: &Path) -> bool {
    dir.join("base.scs").is_file()
}

pub fn find(hint: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = hint.filter(|d| is_game(d)) {
        return Some(dir.to_path_buf());
    }
    for steam in sys::steam_dirs() {
        let mut libraries = vec![steam.clone()];
        if let Ok(vdf) = std::fs::read_to_string(steam.join(r"steamapps\libraryfolders.vdf")) {
            libraries.extend(library_paths(&vdf));
        }
        for lib in libraries {
            let dir = lib.join(r"steamapps\common\Euro Truck Simulator 2");
            if is_game(&dir) {
                return Some(dir);
            }
        }
    }
    None
}

/// The "path" entries of Steam's libraryfolders.vdf.
pub fn library_paths(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("\"path\"")?.trim();
            let value = rest.strip_prefix('"')?.strip_suffix('"')?;
            Some(PathBuf::from(value.replace(r"\\", r"\")))
        })
        .collect()
}

pub fn running() -> bool {
    sys::running(&[GAME_EXE], None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steam_library_folders() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t\t\"label\"\t\t\"\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"F:\\\\SteamLibrary\"\n\t\t\"apps\"\n\t\t{\n\t\t\t\"227300\"\t\t\"21474836480\"\n\t\t}\n\t}\n}\n";
        assert_eq!(
            library_paths(vdf),
            vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"F:\SteamLibrary")]
        );
    }
}
