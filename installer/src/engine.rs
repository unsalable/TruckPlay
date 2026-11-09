//! The work itself, the same for the window, a quiet install and TruckPlay's own update: unpack, the
//! plugin into the game, the app into its folder, the mod from the player's own game files, the map
//! data, shortcuts and Windows' apps list. And the way back out.
//!
//! The new app is unpacked next to the old one (TruckPlay.new) and swapped in with two renames, so
//! a failure on the way leaves the old TruckPlay as it was. The plugin goes in first: it is the one
//! file a running game holds, so a game started meanwhile stops an update before anything changed.

use std::cell::Cell;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::game;
use crate::net;
use crate::payload::Payload;
use crate::places::{Places, is_install_dir};
use crate::sys;
use crate::text::Text;

pub const VERSION: &str = env!("TRUCKPLAY_VERSION");
const TRUCKPLAY: [&str; 3] = ["TruckPlay.exe", "truckplay-media.exe", "tirplay-media.exe"];
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const REPO: &str = "https://github.com/unsalable/TruckPlay";

/// Roads, cities and buildings for the trial window's map and place search: tiles the
/// truckermudgeon/maps project publishes (not ours to redistribute, so fetched once).
pub const MAP_FILES: [(&str, &str); 4] = [
    ("ets2.pmtiles", "https://maps.truckermudgeon.com/ets2.pmtiles"),
    ("ets2-footprints.pmtiles", "https://maps.truckermudgeon.com/ets2-footprints.pmtiles"),
    ("world.pmtiles", "https://maps.truckermudgeon.com/world.pmtiles"),
    ("ets2-search.geojson", "https://truckermudgeon.github.io/ets2-search.geojson"),
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Step {
    Files,
    Plugin,
    App,
    Mod,
    Map,
    Finish,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Waiting,
    Active,
    Done,
    Skipped,
}

/// Where the work tells how it goes: the window, or just the log.
pub trait Report: Sync {
    fn step(&self, step: Step, state: State);
    /// The whole job, 0 to 1.
    fn progress(&self, fraction: f32);
    /// A short line under the progress bar.
    fn detail(&self, text: &str);
    fn log(&self, line: &str);
    /// The game is running (the window says so) or closed again.
    fn game_open(&self, open: bool);
    /// The player gave up waiting for the game.
    fn cancelled(&self) -> bool;
}

pub struct Job<'a> {
    pub places: &'a Places,
    pub game: Option<PathBuf>,
    /// TruckPlay updating itself: nobody to wait for, nothing new on the desktop.
    pub update: bool,
    pub no_map: bool,
    pub text: &'static Text,
}

#[derive(Debug)]
pub enum Failure {
    /// The game is running (an update tries again next time).
    GameRunning,
    Cancelled,
    /// What to tell the player; the details are in the log.
    Error(String),
}

impl Failure {
    pub fn note(&self, t: &Text) -> String {
        match self {
            Failure::GameRunning => "game running".into(),
            Failure::Cancelled => t.err_cancelled.into(),
            Failure::Error(e) => e.clone(),
        }
    }
}

/// The progress bar: each step's share of the whole job.
struct Meter<'a> {
    r: &'a dyn Report,
    weight: [f32; 6],
    total: f32,
    done: Cell<f32>,
}

impl<'a> Meter<'a> {
    fn new(r: &'a dyn Report, weight: [f32; 6]) -> Self {
        let total = weight.iter().sum::<f32>().max(0.0001);
        Meter {
            r,
            weight,
            total,
            done: Cell::new(0.0),
        }
    }

    fn part(&self, step: Step, fraction: f32) {
        let w = self.weight[step as usize] * fraction.clamp(0.0, 1.0);
        self.r.progress(((self.done.get() + w) / self.total).min(1.0));
    }

    fn finish(&self, step: Step) {
        self.done.set(self.done.get() + self.weight[step as usize]);
        self.r.progress((self.done.get() / self.total).min(1.0));
        self.r.step(step, State::Done);
    }
}

fn mb(bytes: u64) -> String {
    format!("{:.0}", bytes as f64 / 1_048_576.0)
}

fn sibling(dir: &Path, name: &str) -> PathBuf {
    dir.parent().map(|p| p.join(name)).unwrap_or_else(|| PathBuf::from(name))
}

fn remove_dir(dir: &Path) -> bool {
    !dir.exists() || fs::remove_dir_all(dir).is_ok()
}

fn remove_file(file: &Path) {
    let _ = fs::remove_file(file);
}

/// A copy that tries again for a few seconds when the target is busy.
fn copy_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut last = None;
    for _ in 0..8 {
        match fs::copy(from, to) {
            Ok(_) => return Ok(()),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Err(last.unwrap_or_else(|| io::Error::other("copy")))
}

fn wait_for_game(job: &Job, r: &dyn Report) -> Result<(), Failure> {
    if !game::running() {
        return Ok(());
    }
    if job.update {
        r.log("Oyun açık: güncelleme bir dahaki sefere.");
        return Err(Failure::GameRunning);
    }
    r.log("Oyun açık: kapanması bekleniyor.");
    r.game_open(true);
    while game::running() {
        if r.cancelled() {
            r.game_open(false);
            return Err(Failure::Cancelled);
        }
        std::thread::sleep(Duration::from_millis(600));
    }
    r.game_open(false);
    r.log("Oyun kapandı.");
    Ok(())
}

/// TruckPlay's own processes: an update waits a little for the one that started it to finish.
fn stop_truckplay(job: &Job, r: &dyn Report) {
    let within = job.places.own_processes();
    if job.update && !sys::wait_gone(&TRUCKPLAY, within, Duration::from_secs(20)) {
        r.log("TruckPlay kendiliğinden kapanmadı.");
    }
    let n = sys::stop(&TRUCKPLAY, within);
    if n > 0 {
        r.log(&format!("{n} TruckPlay işlemi durduruldu."));
    }
}

pub fn install(job: &Job, payload: &Payload, r: &dyn Report) -> Result<(), Failure> {
    let p = job.places;
    let t = job.text;
    r.log(&format!(
        "TruckPlay {VERSION} {}",
        if job.update { "güncellemesi" } else { "kurulumu" }
    ));
    r.log(&format!("Kurulum klasörü: {}", p.install.display()));
    match &job.game {
        Some(g) => r.log(&format!("Oyun: {}", g.display())),
        None => r.log("Oyun bulunamadı: eklenti ve mod kurulmayacak."),
    }
    wait_for_game(job, r)?;
    stop_truckplay(job, r);

    let missing: Vec<(&str, &str)> = if job.no_map {
        Vec::new()
    } else {
        MAP_FILES
            .iter()
            .copied()
            .filter(|(name, _)| !p.map_data().join(name).is_file())
            .collect()
    };
    let has_game = job.game.is_some();
    // Files, Plugin, App, Mod, Map, Finish.
    let m = Meter::new(
        r,
        [
            0.42,
            0.02,
            0.05,
            if has_game { 0.2 } else { 0.0 },
            if missing.is_empty() { 0.0 } else { 0.27 },
            0.04,
        ],
    );

    // 1. Unpack next to the old app: nothing in use changes until all of it is there.
    r.step(Step::Files, State::Active);
    let staging = sibling(&p.install, "TruckPlay.new");
    remove_dir(&staging);
    fs::create_dir_all(&staging).map_err(|e| Failure::Error(format!("{}: {e}", staging.display())))?;
    payload
        .extract(&staging, &mut |read, total| {
            m.part(Step::Files, read as f32 / total.max(1) as f32);
            r.detail(&format!("{} / {} MB", mb(read), mb(total)));
        })
        .map_err(|e| {
            r.log(&format!("Açılamadı: {e}"));
            remove_dir(&staging);
            Failure::Error(t.err_payload.into())
        })?;
    m.finish(Step::Files);

    // 2. The plugin, first.
    let plugins = job.game.as_ref().map(|g| p.plugins(g));
    if let Some(dir) = &plugins {
        r.step(Step::Plugin, State::Active);
        r.detail(&dir.display().to_string());
        let placed = fs::create_dir_all(dir.join("truckplay"))
            .and_then(|_| copy_retry(&staging.join(r"game\truckplay.dll"), &dir.join("truckplay.dll")));
        if let Err(e) = placed {
            r.log(&format!("Eklenti: {e}"));
            remove_dir(&staging);
            return Err(Failure::Error(t.err_plugin.into()));
        }
        m.finish(Step::Plugin);
    } else {
        r.step(Step::Plugin, State::Skipped);
    }

    // 3. The app.
    r.step(Step::App, State::Active);
    r.detail(&p.install.display().to_string());
    swap(&staging, &p.install, r).map_err(|e| {
        r.log(&format!("Uygulama: {e}"));
        Failure::Error(t.err_app.into())
    })?;
    remove_old(p, plugins.as_deref());
    match payload.stub().and_then(|stub| fs::write(p.uninstaller(), stub)) {
        Ok(()) => {}
        Err(e) => r.log(&format!("Kaldırma programı yazılamadı: {e}")),
    }
    let exe = sys::real_path(&p.exe());
    if exe != p.exe() {
        r.log(&format!("Uygulama paketinin deposunda: {}", exe.display()));
    }
    if let Some(dir) = &plugins {
        // The plugin starts TruckPlay with the game, with this command line.
        fs::write(dir.join(r"truckplay\launch.txt"), format!("\"{}\"", exe.display())).map_err(|e| {
            r.log(&format!("launch.txt: {e}"));
            Failure::Error(t.err_plugin.into())
        })?;
    }
    m.finish(Step::App);

    // 4. The mod, made from the player's own game: every cab screen of this game version and of
    //    the trucks they own is measured (TruckPlay.exe doubles as Node.js for it).
    if let Some(game) = &job.game {
        r.step(Step::Mod, State::Active);
        r.detail(t.detail_mod);
        let out = p.mod_dir().join("truckplay.scs");
        let _ = fs::create_dir_all(p.mod_dir());
        let app = p.app();
        let script = app.join(r"mod\build-mod.mjs");
        let args: [&OsStr; 5] = [
            script.as_os_str(),
            "--game".as_ref(),
            game.as_os_str(),
            "--out".as_ref(),
            out.as_os_str(),
        ];
        if !node(&exe, &args, &p.install, r, |f| m.part(Step::Mod, f * 0.8)) {
            r.log("Mod üretilemedi; hazır mod kopyalanıyor.");
            if let Err(e) = fs::copy(p.install.join(r"game\truckplay.scs"), &out) {
                r.log(&format!("Hazır mod: {e}"));
            }
        }
        if !job.no_map {
            r.detail(t.detail_cities);
            let script = app.join(r"map\build-cities.mjs");
            let cities = p.map_data().join("cities.json");
            let _ = fs::create_dir_all(p.map_data());
            let args: [&OsStr; 5] = [
                script.as_os_str(),
                "--game".as_ref(),
                game.as_os_str(),
                "--out".as_ref(),
                cities.as_os_str(),
            ];
            node(&exe, &args, &p.install, r, |f| m.part(Step::Mod, 0.8 + f * 0.2));
        }
        m.finish(Step::Mod);
    } else {
        r.step(Step::Mod, State::Skipped);
    }

    // 5. Map data, once (an update keeps what is there).
    if !missing.is_empty() {
        r.step(Step::Map, State::Active);
        let _ = fs::create_dir_all(p.map_data());
        let count = missing.len() as f32;
        for (i, (name, url)) in missing.iter().enumerate() {
            let dest = p.map_data().join(name);
            let part = p.map_data().join(format!("{name}.part"));
            let got = net::download(url, &part, &format!("TruckPlay-Kurulum/{VERSION}"), &mut |got, total| {
                let f = total.map(|t| got as f32 / t.max(1) as f32).unwrap_or(0.5);
                m.part(Step::Map, (i as f32 + f) / count);
                r.detail(&match total {
                    Some(t) => format!("{name} · {} / {} MB", mb(got), mb(t)),
                    None => format!("{name} · {} MB", mb(got)),
                });
            });
            match got.and_then(|_| fs::rename(&part, &dest).map_err(|e| e.to_string())) {
                Ok(()) => r.log(&format!("{name} indirildi.")),
                Err(e) => {
                    remove_file(&part);
                    // Not fatal: the Maps app falls back to a trail view without them.
                    r.log(&format!("{name} indirilemedi: {e}"));
                }
            }
        }
        m.finish(Step::Map);
    } else {
        r.step(Step::Map, if job.no_map { State::Skipped } else { State::Done });
    }

    // 6. Shortcuts and Windows' apps list.
    r.step(Step::Finish, State::Active);
    r.detail(t.detail_links);
    shortcuts(job, &exe, r);
    apps_list(p, &exe, r);
    m.finish(Step::Finish);
    // The old app goes last: a few seconds of deleting nothing waits for.
    remove_dir(&sibling(&p.install, "TruckPlay.old"));
    r.detail("");
    r.progress(1.0);
    r.log(&format!("TruckPlay {VERSION} kuruldu."));
    Ok(())
}

/// Puts the unpacked app in place of the old one, keeping its downloaded map data.
fn swap(staging: &Path, install: &Path, r: &dyn Report) -> io::Result<()> {
    let keep = install.join(r"resources\app\map\data");
    if keep.is_dir() {
        let into = staging.join(r"resources\app\map\data");
        let _ = fs::remove_dir_all(&into);
        if let Some(parent) = into.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::rename(&keep, &into).is_err() {
            copy_tree(&keep, &into)?;
        }
    }
    if install.exists() {
        let old = sibling(install, "TruckPlay.old");
        remove_dir(&old);
        let mut moved = false;
        for _ in 0..12 {
            if fs::rename(install, &old).is_ok() {
                moved = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if !moved {
            // Something holds the folder (a console window open in it, say): copy over instead.
            r.log("Eski klasör taşınamadı; dosyalar üzerine kopyalanıyor.");
            mirror(staging, install)?;
            remove_dir(staging);
            return Ok(());
        }
    }
    if let Some(parent) = install.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(staging, install)
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Makes `to` the same as `from`: everything copied over, everything else removed.
fn mirror(from: &Path, to: &Path) -> io::Result<()> {
    copy_tree(from, to)?;
    prune(from, to)
}

fn prune(from: &Path, to: &Path) -> io::Result<()> {
    for entry in fs::read_dir(to)? {
        let entry = entry?;
        let source = from.join(entry.file_name());
        let is_dir = entry.file_type()?.is_dir();
        if !source.exists() {
            if is_dir {
                fs::remove_dir_all(entry.path())?;
            } else {
                fs::remove_file(entry.path())?;
            }
        } else if is_dir {
            prune(&source, &entry.path())?;
        }
    }
    Ok(())
}

/// TırPlay, the earlier name: its files go, so the game does not load two plugins.
fn remove_old(p: &Places, plugins: Option<&Path>) {
    if let Some(dir) = plugins {
        remove_file(&dir.join("tirplay.dll"));
        remove_dir(&dir.join("tirplay"));
    }
    remove_file(&p.mod_dir().join("tirplay.scs"));
    remove_file(&p.desktop.join("TırPlay.lnk"));
    // Before 1.7 the trial window's shortcut was just "TruckPlay": it looked like the way to start
    // TruckPlay, which starts with the game by itself.
    remove_file(&p.desktop.join("TruckPlay.lnk"));
    // The PowerShell installer of 1.0 to 1.8.0.
    remove_file(&p.install.join("setup.ps1"));
}

/// Runs one of the app's scripts with TruckPlay.exe as Node.js, logging what it prints. `creep`
/// moves the progress bar along meanwhile (the scripts do not say how far they are).
fn node(exe: &Path, args: &[&OsStr], cwd: &Path, r: &dyn Report, mut creep: impl FnMut(f32)) -> bool {
    let child = Command::new(exe)
        .args(args)
        .current_dir(cwd)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            r.log(&format!("{}: {e}", exe.display()));
            return false;
        }
    };
    let (tx, rx) = mpsc::channel::<String>();
    let streams: [Option<Box<dyn Read + Send>>; 2] = [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
    ];
    for stream in streams.into_iter().flatten() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
    }
    drop(tx);
    let started = Instant::now();
    loop {
        while let Ok(line) = rx.try_recv() {
            r.log(&format!("  {line}"));
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                std::thread::sleep(Duration::from_millis(60));
                while let Ok(line) = rx.try_recv() {
                    r.log(&format!("  {line}"));
                }
                if !status.success() {
                    r.log(&format!("  çıkış kodu {}", status.code().unwrap_or(-1)));
                }
                return status.success();
            }
            Ok(None) => {}
            Err(_) => return false,
        }
        let t = started.elapsed().as_secs_f32();
        if t > 300.0 {
            let _ = child.kill();
            r.log("  5 dakikada bitmedi, durduruldu.");
            return false;
        }
        creep(1.0 - (-t / 6.0).exp());
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn shortcuts(job: &Job, exe: &Path, r: &dyn Report) {
    let p = job.places;
    let _com = sys::Com::init();
    let trial = "TruckPlay — oyunsuz deneme penceresi";
    let mut made = Vec::new();
    // TruckPlay starts with the game by itself; this is only the window to try it without one. An
    // update renews it only if the player kept it.
    if !job.update || p.demo_link().exists() {
        let _ = fs::create_dir_all(&p.desktop);
        made.push(sys::shortcut(&p.demo_link(), exe, "--window --demo", trial, exe));
    }
    let menu = p.start_menu();
    let _ = fs::create_dir_all(&menu);
    made.push(sys::shortcut(
        &menu.join("TruckPlay (deneme).lnk"),
        exe,
        "--window --demo",
        trial,
        exe,
    ));
    let uninstaller = sys::real_path(&p.uninstaller());
    made.push(sys::shortcut(
        &menu.join("TruckPlay'i kaldır.lnk"),
        &uninstaller,
        "--uninstall",
        "TruckPlay'i kaldır",
        &uninstaller,
    ));
    for e in made.into_iter().filter_map(Result::err) {
        r.log(&format!("Kısayol: {}", e.message()));
    }
}

fn folder_size(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| match e.file_type() {
                    Ok(t) if t.is_dir() => folder_size(&e.path()),
                    _ => e.metadata().map(|m| m.len()).unwrap_or(0),
                })
                .sum()
        })
        .unwrap_or(0)
}

/// Settings > Apps lists TruckPlay with its own Uninstall button (for this user: no administrator).
fn apps_list(p: &Places, exe: &Path, r: &dyn Report) {
    let Some(key) = sys::Key::create(p.apps_key) else {
        r.log("Windows uygulama listesine yazılamadı.");
        return;
    };
    let install = exe.parent().map(Path::to_path_buf).unwrap_or_else(|| p.install.clone());
    let uninstaller = install.join("TruckPlay-Kaldir.exe");
    let date = crate::log::now_iso().replace('-', "");
    let ok = [
        key.set_str("DisplayName", "TruckPlay"),
        key.set_str("DisplayVersion", VERSION),
        key.set_str("Publisher", "TruckPlay"),
        key.set_str("DisplayIcon", &format!("{},0", exe.display())),
        key.set_str("InstallLocation", &install.display().to_string()),
        key.set_str("UninstallString", &format!("\"{}\" --uninstall", uninstaller.display())),
        key.set_str(
            "QuietUninstallString",
            &format!("\"{}\" --uninstall --quiet", uninstaller.display()),
        ),
        key.set_str("URLInfoAbout", REPO),
        key.set_str("InstallDate", &date[..8]),
        key.set_dword("NoModify", 1),
        key.set_dword("NoRepair", 1),
        key.set_dword("EstimatedSize", (folder_size(&install) / 1024) as u32),
    ];
    if ok.iter().any(|done| !done) {
        r.log("Windows uygulama listesine bazı bilgiler yazılamadı.");
    }
}

/// Removes TruckPlay: the plugin, the mod, shortcuts, the apps list entry, the updates and the app.
/// The game itself and its saves are never touched.
pub fn uninstall(job: &Job, r: &dyn Report) -> Result<(), Failure> {
    let p = job.places;
    r.log(&format!("TruckPlay kaldırılıyor: {}", p.install.display()));
    wait_for_game(job, r)?;
    stop_truckplay(job, r);
    // Plugin, Mod, Finish (shortcuts and the apps list), App: in that order on screen.
    let m = Meter::new(r, [0.0, 0.1, 0.65, 0.1, 0.0, 0.15]);
    let mut left: Vec<PathBuf> = Vec::new();

    r.step(Step::Plugin, State::Active);
    if let Some(game) = &job.game {
        let dir = p.plugins(game);
        remove_file(&dir.join("truckplay.dll"));
        if !remove_dir(&dir.join("truckplay")) {
            left.push(dir.join("truckplay"));
        }
        if dir.join("truckplay.dll").exists() {
            left.push(dir.join("truckplay.dll"));
        }
        remove_old(p, Some(&dir));
    }
    m.finish(Step::Plugin);

    r.step(Step::Mod, State::Active);
    remove_file(&p.mod_dir().join("truckplay.scs"));
    remove_file(&p.mod_dir().join("tirplay.scs"));
    m.finish(Step::Mod);

    r.step(Step::Finish, State::Active);
    remove_file(&p.demo_link());
    remove_dir(&p.start_menu());
    sys::delete_key(p.apps_key);
    m.finish(Step::Finish);

    r.step(Step::App, State::Active);
    remove_dir(&p.updates);
    if p.install.exists() && (is_install_dir(&p.install) || p.install.join("TruckPlay-Kaldir.exe").exists()) && !remove_dir(&p.install) {
        left.push(p.install.clone());
    }
    remove_dir(&sibling(&p.install, "TruckPlay.old"));
    remove_dir(&sibling(&p.install, "TruckPlay.new"));
    m.finish(Step::App);

    if let Some(first) = left.first() {
        for l in &left {
            r.log(&format!("Silinemedi: {}", l.display()));
        }
        return Err(Failure::Error(job.text.err_left.replace("{path}", &first.display().to_string())));
    }
    r.log("TruckPlay kaldırıldı.");
    Ok(())
}

/// A reporter with nobody watching: everything goes to the log.
pub struct Quiet<'a>(pub &'a crate::log::Log);

impl Report for Quiet<'_> {
    fn step(&self, step: Step, state: State) {
        if state == State::Active {
            self.0.line(&format!("» {step:?}"));
        }
    }
    fn progress(&self, _: f32) {}
    fn detail(&self, _: &str) {}
    fn log(&self, line: &str) {
        self.0.line(line);
    }
    fn game_open(&self, _: bool) {}
    fn cancelled(&self) -> bool {
        false
    }
}
