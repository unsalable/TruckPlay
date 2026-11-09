//! The command line. The names are the ones the old PowerShell installer took, because TruckPlay
//! 1.8.0 starts its update exactly so: `TruckPlay-Kurulum.exe -Update <folder> -InstallDir <folder>
//! -GameDir <folder>` (host/src/updater.js). `-Name`, `--name` and `/name` all work, in any case.

use std::ffi::OsString;
use std::path::PathBuf;

#[derive(Debug, Default, Clone)]
pub struct Args {
    /// Remove TruckPlay.
    pub uninstall: bool,
    /// No window at all (for scripts); `-Update` is always quiet.
    pub quiet: bool,
    /// Skip the map data (cities and the downloaded tiles).
    pub no_map: bool,
    /// TruckPlay updating itself: the folder for update.log and result.json.
    pub update: Option<PathBuf>,
    pub game_dir: Option<PathBuf>,
    pub install_dir: Option<PathBuf>,
    /// For developers: every place the installer writes to moves under this folder (the game's
    /// plugin folder too), so a whole install can be tried without touching the real one.
    pub sandbox: Option<PathBuf>,
    /// For developers: draw every screen into PNG files in this folder and quit.
    pub render: Option<PathBuf>,
    /// The uninstaller's own copy in %TEMP% (so it can remove the folder it came from).
    pub relaunched: bool,
}

fn name(arg: &str) -> Option<String> {
    let trimmed = arg.trim_start_matches(['-', '/']);
    (trimmed.len() < arg.len() && !trimmed.is_empty()).then(|| trimmed.to_ascii_lowercase())
}

pub fn parse(argv: impl IntoIterator<Item = OsString>) -> Args {
    let argv: Vec<String> = argv.into_iter().map(|a| a.to_string_lossy().into_owned()).collect();
    let mut a = Args::default();
    let mut i = 0;
    while i < argv.len() {
        let Some(n) = name(&argv[i]) else {
            i += 1;
            continue;
        };
        // A value is the next argument, unless that is itself an option.
        let value = argv
            .get(i + 1)
            .filter(|v| name(v).is_none() || v.contains(['\\', ':']))
            .map(PathBuf::from);
        let mut took = false;
        let mut take = |slot: &mut Option<PathBuf>| {
            *slot = value.clone();
            took = value.is_some();
        };
        match n.as_str() {
            "uninstall" => a.uninstall = true,
            "quiet" | "silent" => a.quiet = true,
            "nomap" => a.no_map = true,
            "update" => {
                take(&mut a.update);
                if a.update.is_none() {
                    a.update = Some(PathBuf::new());
                }
            }
            "gamedir" => take(&mut a.game_dir),
            "installdir" => take(&mut a.install_dir),
            "sandbox" => take(&mut a.sandbox),
            "render" => take(&mut a.render),
            "tp-relaunched" => a.relaunched = true,
            _ => {}
        }
        i += if took { 2 } else { 1 };
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str]) -> Args {
        parse(args.iter().map(OsString::from))
    }

    #[test]
    fn the_update_line_truckplay_1_8_0_sends() {
        let a = p(&[
            "-Update",
            r"C:\Users\x\AppData\Local\TruckPlay-updates",
            "-InstallDir",
            r"C:\Users\x\AppData\Local\TruckPlay",
            "-GameDir",
            r"F:\SteamLibrary\steamapps\common\Euro Truck Simulator 2",
        ]);
        assert_eq!(a.update.unwrap(), PathBuf::from(r"C:\Users\x\AppData\Local\TruckPlay-updates"));
        assert_eq!(a.install_dir.unwrap(), PathBuf::from(r"C:\Users\x\AppData\Local\TruckPlay"));
        assert_eq!(
            a.game_dir.unwrap(),
            PathBuf::from(r"F:\SteamLibrary\steamapps\common\Euro Truck Simulator 2")
        );
        assert!(!a.uninstall && !a.quiet);
    }

    #[test]
    fn flags_in_any_spelling() {
        let a = p(&["--UNINSTALL", "/quiet", "-NoMap"]);
        assert!(a.uninstall && a.quiet && a.no_map);
        let b = p(&["-Uninstall", "-Quiet"]);
        assert!(b.uninstall && b.quiet);
    }

    #[test]
    fn an_option_without_its_value() {
        let a = p(&["-GameDir", "-Quiet"]);
        assert!(a.game_dir.is_none());
        assert!(a.quiet);
        let b = p(&["-Update"]);
        assert_eq!(b.update, Some(PathBuf::new()));
    }
}
