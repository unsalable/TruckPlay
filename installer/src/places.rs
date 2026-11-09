//! Where everything goes. Normally the player's own folders; in a sandbox (--sandbox, or
//! TRUCKPLAY_SETUP_SANDBOX for a test host's updates) everything moves under one folder, the game's
//! plugin folder too, so a developer can install, update and remove TruckPlay without touching the
//! real one. The game itself is only ever read.

use std::path::{Path, PathBuf};

use windows::Win32::UI::Shell::{FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_LocalAppData, FOLDERID_Programs};

use crate::args::Args;
use crate::sys;

pub const APPS_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\TruckPlay";
const SANDBOX_APPS_KEY: &str = r"Software\TruckPlay-sandbox\Uninstall\TruckPlay";

pub struct Places {
    pub install: PathBuf,
    pub updates: PathBuf,
    pub documents: PathBuf,
    pub desktop: PathBuf,
    pub programs: PathBuf,
    pub temp: PathBuf,
    /// Sandbox: the plugin goes here instead of into the game.
    plugins: Option<PathBuf>,
    pub apps_key: &'static str,
    pub sandbox: Option<PathBuf>,
}

/// Whether `dir` is a TruckPlay install: the update mirrors into it and the uninstaller removes
/// it, so nothing else may pass for one.
pub fn is_install_dir(dir: &Path) -> bool {
    dir.file_name().is_some_and(|n| n.eq_ignore_ascii_case("TruckPlay"))
        && dir.join("TruckPlay.exe").is_file()
        && dir.join(r"resources\app\host\src\main.js").is_file()
}

impl Places {
    pub fn new(args: &Args) -> Places {
        let sandbox = args
            .sandbox
            .clone()
            .or_else(|| std::env::var_os("TRUCKPLAY_SETUP_SANDBOX").map(PathBuf::from));
        let temp = std::env::temp_dir();
        let mut p = match &sandbox {
            Some(root) => Places {
                install: root.join(r"Local\TruckPlay"),
                updates: root.join(r"Local\TruckPlay-updates"),
                documents: root.join("Documents"),
                desktop: root.join("Desktop"),
                programs: root.join("Programs"),
                temp,
                plugins: Some(root.join("plugins")),
                apps_key: SANDBOX_APPS_KEY,
                sandbox: Some(root.clone()),
            },
            None => {
                let local = sys::known_folder(&FOLDERID_LocalAppData)
                    .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
                    .unwrap_or_else(|| temp.clone());
                let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| temp.clone());
                Places {
                    install: local.join("TruckPlay"),
                    updates: local.join("TruckPlay-updates"),
                    documents: sys::known_folder(&FOLDERID_Documents).unwrap_or_else(|| home.join("Documents")),
                    desktop: sys::known_folder(&FOLDERID_Desktop).unwrap_or_else(|| home.join("Desktop")),
                    programs: sys::known_folder(&FOLDERID_Programs)
                        .unwrap_or_else(|| local.join(r"..\Roaming\Microsoft\Windows\Start Menu\Programs")),
                    temp,
                    plugins: None,
                    apps_key: APPS_KEY,
                    sandbox: None,
                }
            }
        };
        // An update (or the uninstaller) works on the TruckPlay that started it, wherever it is.
        if let Some(dir) = args.install_dir.as_deref().filter(|d| is_install_dir(d)) {
            p.install = dir.to_path_buf();
        }
        if let Some(dir) = args.update.as_deref().filter(|d| !d.as_os_str().is_empty()) {
            p.updates = dir.to_path_buf();
        }
        p
    }

    /// The game's plugin folder (bin\win_x64\plugins), or the sandbox's.
    pub fn plugins(&self, game: &Path) -> PathBuf {
        self.plugins.clone().unwrap_or_else(|| game.join(r"bin\win_x64\plugins"))
    }

    pub fn mod_dir(&self) -> PathBuf {
        self.documents.join(r"Euro Truck Simulator 2\mod")
    }

    pub fn demo_link(&self) -> PathBuf {
        self.desktop.join("TruckPlay (deneme).lnk")
    }

    pub fn start_menu(&self) -> PathBuf {
        self.programs.join("TruckPlay")
    }

    pub fn app(&self) -> PathBuf {
        self.install.join(r"resources\app")
    }

    pub fn exe(&self) -> PathBuf {
        self.install.join("TruckPlay.exe")
    }

    pub fn uninstaller(&self) -> PathBuf {
        self.install.join("TruckPlay-Kaldir.exe")
    }

    pub fn map_data(&self) -> PathBuf {
        self.app().join(r"map\data")
    }

    /// TruckPlay's processes as Windows lists them; in a sandbox only the sandbox's own count.
    pub fn own_processes(&self) -> Option<&Path> {
        self.sandbox.as_ref().map(|_| self.install.as_path())
    }
}

/// The version of the TruckPlay in `dir`, from its package.json.
pub fn installed_version(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(r"resources\app\package.json")).ok()?;
    let rest = text.split("\"version\"").nth(1)?;
    let v = rest.split('"').nth(1)?;
    (!v.is_empty()).then(|| v.to_string())
}
