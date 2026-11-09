#![windows_subsystem = "windows"]
// Drawing helpers take a rectangle, a size, a weight, a colour… as CSS would.
#![allow(clippy::too_many_arguments)]
//! TruckPlay-Kurulum.exe: TruckPlay in one file, with a window of its own (Rust, Direct2D).
//!
//!   TruckPlay-Kurulum.exe                    the installer window (install or update)
//!   TruckPlay-Kurulum.exe -Uninstall         remove TruckPlay (TruckPlay-Kaldir.exe, the copy in
//!                                            TruckPlay's folder, does only that)
//!   TruckPlay-Kurulum.exe -Quiet             install (or with -Uninstall remove) without a window
//!   TruckPlay-Kurulum.exe -Update <folder>   TruckPlay updating itself (host/src/updater.js): no
//!                                            window; update.log and result.json in <folder>
//!   -GameDir <folder>   the game, if Steam does not know it    -InstallDir <folder>   (updates)
//!   -NoMap              no map data
//!   --sandbox <folder>  developers: everything under <folder> (the game is only read)
//!   --render <folder>   developers: every screen as a PNG

mod args;
mod engine;
mod game;
mod log;
mod net;
mod payload;
mod places;
mod sys;
mod text;
mod ui;

use std::path::Path;

use args::Args;
use engine::{Failure, Job, Quiet};
use places::Places;
use text::Text;

fn main() {
    let args = args::parse(std::env::args_os().skip(1));
    std::process::exit(run(&args));
}

fn run(args: &Args) -> i32 {
    let t = text::text();
    if let Some(dir) = &args.render {
        return ui::render_screens(dir, t);
    }
    let places = Places::new(args);
    let Some(payload) = (!args.uninstall).then(payload::find).flatten() else {
        return remove(args, places, t);
    };
    if args.update.is_some() {
        return update(args, &places, &payload, t);
    }
    let game = game::find(args.game_dir.as_deref());
    if args.quiet {
        let log = log::Log::create(places.temp.join("TruckPlay-kurulum.log"));
        let job = Job {
            places: &places,
            game,
            update: false,
            no_map: args.no_map,
            text: t,
        };
        return match engine::install(&job, &payload, &Quiet(&log)) {
            Ok(()) => 0,
            Err(e) => {
                log.line(&e.note(t));
                1
            }
        };
    }
    ui::install_window(
        ui::Install {
            places,
            payload,
            game,
            no_map: args.no_map,
        },
        t,
    )
}

/// TruckPlay updating itself, after the game has closed: hidden, and what happened goes to
/// update.log and result.json, which the next TruckPlay reads (host/src/updater.js).
fn update(args: &Args, places: &Places, payload: &payload::Payload, t: &'static Text) -> i32 {
    let log = log::Log::create(places.updates.join("update.log"));
    write_result(&places.updates, false, "started");
    let job = Job {
        places,
        game: game::find(args.game_dir.as_deref()),
        update: true,
        no_map: args.no_map,
        text: t,
    };
    match engine::install(&job, payload, &Quiet(&log)) {
        Ok(()) => {
            write_result(&places.updates, true, "installed");
            0
        }
        Err(e) => {
            let note = e.note(t);
            log.line(&format!("Güncelleme olmadı: {note}"));
            write_result(&places.updates, false, &note);
            if matches!(e, Failure::GameRunning) { 3 } else { 1 }
        }
    }
}

fn write_result(dir: &Path, ok: bool, note: &str) {
    let json = format!(
        "{{\"version\":{},\"ok\":{ok},\"note\":{},\"at\":{}}}",
        log::json_string(engine::VERSION),
        log::json_string(note),
        log::json_string(&log::now_iso())
    );
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join("result.json"), json);
}

fn remove(args: &Args, places: Places, t: &'static Text) -> i32 {
    // The uninstaller lives in the folder it removes: it works from a copy in %TEMP%.
    if !args.relaunched
        && let Ok(me) = std::env::current_exe()
        && me.starts_with(&places.install)
    {
        let copy = places.temp.join("TruckPlay-Kaldir.exe");
        if std::fs::copy(&me, &copy).is_ok() {
            let started = std::process::Command::new(&copy)
                .args(std::env::args_os().skip(1))
                .arg("--tp-relaunched")
                .arg("-InstallDir")
                .arg(&places.install)
                .spawn();
            if started.is_ok() {
                return 0;
            }
        }
    }
    let game = game::find(args.game_dir.as_deref());
    let code = if args.quiet {
        let log = log::Log::create(places.temp.join("TruckPlay-kaldirma.log"));
        let job = Job {
            places: &places,
            game,
            update: false,
            no_map: false,
            text: t,
        };
        match engine::uninstall(&job, &Quiet(&log)) {
            Ok(()) => 0,
            Err(e) => {
                log.line(&e.note(t));
                1
            }
        }
    } else {
        ui::remove_window(ui::Remove { places, game }, t)
    };
    if args.relaunched
        && let Ok(me) = std::env::current_exe()
    {
        sys::delete_at_restart(&me);
    }
    code
}
