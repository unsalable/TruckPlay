//! The installer's screens, drawn from a Scene (what phase it is in and what to show), for the
//! window and for --render's pictures alike. TruckPlay's night palette and glass cards
//! (ui/src/design/tokens.css), Apple's system colours, Inter. Most screens are one centred column
//! over a bar of buttons as wide as the content; the work in progress lists its steps.

use super::gfx::{Align, Canvas, Rect, Rgba, Weight, rgb, rgba};
use crate::engine::{State, Step};
use crate::text::Text;

pub const W: f32 = 600.0;
pub const H: f32 = 460.0;
const PAD: f32 = 40.0;
/// The buttons' row.
const ACTIONS: Rect = Rect::new(PAD, H - 32.0 - 48.0, W - 2.0 * PAD, 48.0);
/// The strip at the top that drags the window.
pub const TITLE_BAR: f32 = 56.0;

const INK: Rgba = rgb(0xf5f5f7);
const INK2: Rgba = rgba(0xebebf5, 0.66);
const INK3: Rgba = rgba(0xebebf5, 0.42);
const INK4: Rgba = rgba(0xebebf5, 0.20);
const BLUE: Rgba = rgb(0x0a84ff);
const BLUE_SOFT: Rgba = rgb(0x64b5ff);
const GREEN: Rgba = rgb(0x30d158);
const ORANGE: Rgba = rgb(0xff9f0a);
const RED: Rgba = rgb(0xff453a);
const ON_ORANGE: Rgba = rgb(0x1c1206);
const CARD: Rgba = rgba(0xffffff, 0.055);
const CARD_EDGE: Rgba = rgba(0xffffff, 0.10);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Welcome,
    Waiting,
    Working,
    Done,
    Failed,
    Confirm,
    Removed,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Hit {
    Close,
    Minimize,
    Primary,
    Secondary,
    Folder,
    Log,
}

pub struct Scene<'a> {
    pub t: &'static Text,
    /// The uninstaller.
    pub remove: bool,
    pub phase: Phase,
    /// Seconds since this phase began (its entrance), and since the window opened (spinners).
    pub age: f32,
    pub clock: f32,
    pub steps: [State; 6],
    pub progress: f32,
    pub detail: &'a str,
    pub error: &'a str,
    pub game: Option<&'a str>,
    pub game_note: Option<&'a str>,
    /// The TruckPlay installed now, if any; `same` when it is this very version.
    pub installed: Option<&'a str>,
    pub same: bool,
    pub version: &'a str,
    pub log_path: &'a str,
    pub hover: Option<Hit>,
    pub pressed: Option<Hit>,
}

type Hits = Vec<(Hit, Rect)>;

fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

/// A gentle spring from 0 to 1 with a touch of overshoot, for the big signs.
fn spring(t: f32) -> f32 {
    if t <= 0.0 {
        return 0.0;
    }
    1.0 - (-t * 9.0).exp() * (t * 13.0).cos()
}

pub fn draw(c: &Canvas, s: &Scene) -> Hits {
    let mut hits = Vec::new();
    background(c);
    chrome(c, s, &mut hits, s.phase != Phase::Working);

    // Each screen comes in softly: up a little, out of nothing.
    let e = ease_out(s.age / 0.42);
    c.set_fade(e);
    c.set_transform(0.0, 14.0 * (1.0 - e), 1.0, 0.0, 0.0);
    match s.phase {
        Phase::Welcome => welcome(c, s, &mut hits),
        Phase::Waiting => waiting(c, s, &mut hits),
        Phase::Working => working(c, s),
        Phase::Done => done(c, s, &mut hits),
        Phase::Failed => failed(c, s, &mut hits),
        Phase::Confirm => confirm(c, s, &mut hits),
        Phase::Removed => removed(c, s, &mut hits),
    }
    c.reset_transform();
    c.set_fade(1.0);
    hits
}

/// TruckPlay's night: the gradient and soft glows of its README panels and wallpapers.
fn background(c: &Canvas) {
    let full = Rect::new(0.0, 0.0, W, H);
    c.clear(rgb(0x0b0e22));
    // CSS linear-gradient(160deg, …): the line through the middle, as long as the box needs.
    let (sin, cos) = (160f32.to_radians().sin(), 160f32.to_radians().cos());
    let half = (W * sin.abs() + H * cos.abs()) / 2.0;
    let (dx, dy) = (sin * half, -cos * half);
    c.fill_round_gradient(
        full,
        0.0,
        (W / 2.0 - dx, H / 2.0 - dy),
        (W / 2.0 + dx, H / 2.0 + dy),
        &[(0.0, rgb(0x070a18)), (0.55, rgb(0x12153a)), (1.0, rgb(0x2a1243))],
    );
    c.glow(full, 0.08 * W, 0.0, 0.62 * W, 0.8 * H, rgba(0x0a84ff, 0.30), 0.7);
    c.glow(full, W, H, 0.6 * W, 0.8 * H, rgba(0xbf5af2, 0.24), 0.7);
    c.glow(full, 0.72 * W, 0.08 * H, 0.42 * W, 0.5 * H, rgba(0xff375f, 0.10), 0.7);
}

/// The window's own title bar: the version, then minimize and close as soft circles.
fn chrome(c: &Canvas, s: &Scene, hits: &mut Hits, can_close: bool) {
    if !s.version.is_empty() {
        let version = s.t.version.replace("{v}", s.version);
        c.text(&version, Rect::new(22.0, 14.0, 200.0, 30.0), 12.5, Weight::SemiBold, INK4, Align::Left);
    }
    let min = Rect::new(W - 84.0, 14.0, 30.0, 30.0);
    let close = Rect::new(W - 46.0, 14.0, 30.0, 30.0);
    if s.hover == Some(Hit::Minimize) {
        c.fill_circle(min.cx(), min.cy(), 15.0, rgba(0xffffff, 0.10));
    }
    c.line((min.cx() - 5.0, min.cy()), (min.cx() + 5.0, min.cy()), INK2, 1.6);
    hits.push((Hit::Minimize, min));
    if can_close {
        let hot = s.hover == Some(Hit::Close);
        if hot {
            c.fill_circle(close.cx(), close.cy(), 15.0, RED.alpha(0.92));
        }
        let (x, y, k) = (close.cx(), close.cy(), 4.6);
        let ink = if hot { INK } else { INK2 };
        c.line((x - k, y - k), (x + k, y + k), ink, 1.6);
        c.line((x + k, y - k), (x - k, y + k), ink, 1.6);
        hits.push((Hit::Close, close));
    }
}

fn glass(c: &Canvas, r: Rect) {
    c.fill_round(r, 18.0, CARD);
    c.stroke_round(r, 18.0, CARD_EDGE, 1.0);
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Primary,
    Secondary,
    Danger,
}

/// The row of buttons at the bottom, sharing its width: one fills it, two take half each.
fn actions(c: &Canvas, s: &Scene, hits: &mut Hits, buttons: &[(Hit, &str, Kind, bool)]) {
    let gap = 12.0;
    let n = buttons.len() as f32;
    let w = (ACTIONS.w - gap * (n - 1.0)) / n;
    for (i, &(hit, label, kind, enabled)) in buttons.iter().enumerate() {
        let r = Rect::new(ACTIONS.x + i as f32 * (w + gap), ACTIONS.y, w, ACTIONS.h);
        button(c, s, r, hit, label, kind, enabled);
        if enabled {
            hits.push((hit, r));
        }
    }
}

fn button(c: &Canvas, s: &Scene, r: Rect, hit: Hit, label: &str, kind: Kind, enabled: bool) {
    let radius = r.h / 2.0;
    if !enabled {
        c.fill_round(r, radius, rgba(0xffffff, 0.06));
        c.text(label, r, 16.0, Weight::SemiBold, INK3, Align::Center);
        return;
    }
    let hot = s.hover == Some(hit);
    let down = hot && s.pressed == Some(hit);
    // Hover lightens, a press darkens: quick and flat.
    let tone = |col: Rgba| {
        if down {
            col.mix(rgb(0x000000), 0.14)
        } else if hot {
            col.mix(rgb(0xffffff), 0.10)
        } else {
            col
        }
    };
    match kind {
        Kind::Primary | Kind::Danger => {
            let (top, bottom, glow) = if kind == Kind::Primary {
                (rgb(0x3d9cff), rgb(0x0a6cf5), rgb(0x0a6cf5))
            } else {
                (rgb(0xff6b62), rgb(0xe5372c), rgb(0xe5372c))
            };
            // A soft coloured shadow under it.
            for (i, a) in [(1.0, 0.16), (2.0, 0.08)] {
                c.fill_round(
                    Rect::new(r.x + 10.0 - i, r.y + 6.0 + i * 2.0, r.w - 20.0 + i * 2.0, r.h - 2.0),
                    radius,
                    glow.alpha(a),
                );
            }
            c.fill_round_gradient(r, radius, (r.x, r.y), (r.x, r.bottom()), &[(0.0, tone(top)), (1.0, tone(bottom))]);
            c.stroke_round(r, radius, rgba(0xffffff, 0.16), 1.0);
            c.text(label, r, 16.0, Weight::SemiBold, rgb(0xffffff), Align::Center);
        }
        Kind::Secondary => {
            c.fill_round(r, radius, tone(rgba(0xffffff, 0.08)));
            c.stroke_round(r, radius, rgba(0xffffff, 0.08), 1.0);
            c.text(label, r, 16.0, Weight::SemiBold, INK, Align::Center);
        }
    }
}

fn check_mark(c: &Canvas, cx: f32, cy: f32, r: f32, drawn: f32, color: Rgba, width: f32) {
    let a = (cx - r * 0.42, cy + r * 0.02);
    let b = (cx - r * 0.12, cy + r * 0.32);
    let d = (cx + r * 0.44, cy - r * 0.30);
    let drawn = drawn.clamp(0.0, 1.0);
    if drawn <= 0.0 {
        return;
    }
    // The short stroke is a third of the way.
    if drawn < 0.34 {
        let k = drawn / 0.34;
        c.polyline(&[a, (a.0 + (b.0 - a.0) * k, a.1 + (b.1 - a.1) * k)], color, width);
    } else {
        let k = (drawn - 0.34) / 0.66;
        c.polyline(&[a, b, (b.0 + (d.0 - b.0) * k, b.1 + (d.1 - b.1) * k)], color, width);
    }
}

fn exclamation(c: &Canvas, cx: f32, cy: f32, r: f32, color: Rgba) {
    c.line((cx, cy - r * 0.42), (cx, cy + r * 0.10), color, r * 0.17);
    c.fill_circle(cx, cy + r * 0.40, r * 0.10, color);
}

fn pause_bars(c: &Canvas, cx: f32, cy: f32, r: f32, color: Rgba) {
    let (dx, h) = (r * 0.2, r * 0.32);
    c.line((cx - dx, cy - h), (cx - dx, cy + h), color, r * 0.17);
    c.line((cx + dx, cy - h), (cx + dx, cy + h), color, r * 0.17);
}

/// The big round sign of the centred screens, springing in, with a glow of its colour.
enum Sign {
    Check,
    Warning,
    Pause,
}

fn sign(c: &Canvas, s: &Scene, cy: f32, kind: Sign) {
    let (cx, r) = (W / 2.0, 34.0);
    let k = spring(s.age * 1.4).clamp(0.0, 1.15);
    let color = match kind {
        Sign::Check => GREEN,
        Sign::Warning | Sign::Pause => ORANGE,
    };
    c.glow(
        Rect::new(cx - 120.0, cy - 120.0, 240.0, 240.0),
        cx,
        cy,
        104.0,
        104.0,
        color.alpha(0.22),
        0.9,
    );
    if let Sign::Pause = kind {
        // Waiting, not stuck: a slow ring.
        let p = (s.clock % 1.8) / 1.8;
        c.fill_circle(cx, cy, r + 18.0 * ease_out(p), ORANGE.alpha(0.28 * (1.0 - p)));
    }
    c.fill_circle(cx, cy, r * k, color);
    match kind {
        Sign::Check => check_mark(c, cx, cy, r * k, (s.age - 0.18) / 0.4, rgb(0xffffff), 5.0),
        Sign::Warning => exclamation(c, cx, cy, r * k, ON_ORANGE),
        Sign::Pause => pause_bars(c, cx, cy, r * k, ON_ORANGE),
    }
}

/// A folder for one line `w` wide: `F:\…\common\Euro Truck Simulator 2` rather than cut at the end.
fn fit_path(c: &Canvas, path: &str, size: f32, w: f32) -> String {
    if c.g.measure(path, size, Weight::Regular).0 <= w {
        return path.to_string();
    }
    let parts: Vec<&str> = path.split('\\').collect();
    for k in 2..parts.len() {
        let candidate = format!("{}\\…\\{}", parts[0], parts[k..].join("\\"));
        if c.g.measure(&candidate, size, Weight::Regular).0 <= w {
            return candidate;
        }
    }
    path.to_string()
}

/// Icon, title and subtitle in the middle (the welcome and the uninstaller's question).
fn hero(c: &Canvas, title: &str, subtitle: &str) {
    c.icon(Rect::new(W / 2.0 - 38.0, 46.0, 76.0, 76.0));
    c.text(
        title,
        Rect::new(PAD, 134.0, W - 2.0 * PAD, 38.0),
        30.0,
        Weight::Bold,
        INK,
        Align::Center,
    );
    c.text(
        subtitle,
        Rect::new(PAD, 172.0, W - 2.0 * PAD, 24.0),
        15.5,
        Weight::Regular,
        INK2,
        Align::Center,
    );
}

fn welcome(c: &Canvas, s: &Scene, hits: &mut Hits) {
    let t = s.t;
    hero(c, "TruckPlay", t.tagline);

    let card = Rect::new(PAD, 216.0, W - 2.0 * PAD, 74.0);
    glass(c, card);
    let (gx, gy) = (card.x + 32.0, card.cy());
    let found = s.game.is_some() && s.game_note.is_none();
    if found {
        c.fill_circle(gx, gy, 12.5, GREEN);
        check_mark(c, gx, gy, 12.5, 1.0, rgb(0xffffff), 2.2);
    } else {
        c.fill_circle(gx, gy, 12.5, ORANGE);
        exclamation(c, gx, gy, 12.5, ON_ORANGE);
    }
    let link = if s.game.is_some() { t.change } else { t.choose };
    let (lw, _) = c.g.measure(link, 15.0, Weight::SemiBold);
    let text_w = card.w - 58.0 - lw - 52.0;
    c.text(
        if found { t.game_found } else { t.game_missing },
        Rect::new(card.x + 58.0, card.y + 13.0, text_w, 24.0),
        15.5,
        Weight::SemiBold,
        INK,
        Align::Left,
    );
    let sub = match (s.game_note, s.game) {
        (Some(note), _) => (note.to_string(), ORANGE),
        (None, Some(dir)) => (fit_path(c, dir, 13.0, text_w), INK3),
        (None, None) => (t.game_missing_hint.to_string(), INK3),
    };
    c.text(
        &sub.0,
        Rect::new(card.x + 58.0, card.y + 38.0, text_w, 22.0),
        13.0,
        Weight::Regular,
        sub.1,
        Align::Left,
    );
    // "Change" / "Choose folder": a quiet link inside the card.
    let lr = Rect::new(card.right() - 18.0 - lw - 24.0, card.cy() - 17.0, lw + 24.0, 34.0);
    if s.hover == Some(Hit::Folder) {
        c.fill_round(lr, 17.0, rgba(0x0a84ff, if s.pressed == Some(Hit::Folder) { 0.24 } else { 0.15 }));
    }
    c.text(link, lr, 15.0, Weight::SemiBold, BLUE_SOFT, Align::Center);
    hits.push((Hit::Folder, lr));

    let note = match s.installed {
        Some(v) => format!("{} {}", t.installed_now.replace("{v}", v), t.keeps),
        None => t.what_it_does.to_string(),
    };
    c.paragraph(
        &note,
        Rect::new(PAD + 20.0, 306.0, W - 2.0 * PAD - 40.0, 60.0),
        14.0,
        Weight::Regular,
        INK3,
        Align::Center,
    );

    let label = match (s.installed, s.same) {
        (Some(_), true) => t.reinstall,
        (Some(_), false) => t.update,
        (None, _) => t.install,
    };
    actions(c, s, hits, &[(Hit::Primary, label, Kind::Primary, found)]);
}

fn waiting(c: &Canvas, s: &Scene, hits: &mut Hits) {
    let t = s.t;
    sign(c, s, 158.0, Sign::Pause);
    c.text(
        t.game_open,
        Rect::new(PAD, 212.0, W - 2.0 * PAD, 36.0),
        26.0,
        Weight::Bold,
        INK,
        Align::Center,
    );
    let hint = if s.remove { t.game_open_remove_hint } else { t.game_open_hint };
    c.paragraph(
        hint,
        Rect::new(PAD + 30.0, 254.0, W - 2.0 * PAD - 60.0, 60.0),
        15.0,
        Weight::Regular,
        INK2,
        Align::Center,
    );
    actions(c, s, hits, &[(Hit::Secondary, t.cancel, Kind::Secondary, true)]);
}

/// The steps on screen, in order, with their names.
fn step_list(s: &Scene) -> Vec<(Step, &'static str)> {
    let t = s.t;
    if s.remove {
        vec![
            (Step::Plugin, t.step_plugin),
            (Step::Mod, t.step_mod_remove),
            (Step::Finish, t.step_links_remove),
            (Step::App, t.step_app),
        ]
    } else {
        vec![
            (Step::Files, t.step_files),
            (Step::Plugin, t.step_plugin),
            (Step::App, t.step_app),
            (Step::Mod, t.step_mod),
            (Step::Map, t.step_map),
            (Step::Finish, t.step_finish),
        ]
    }
}

fn working(c: &Canvas, s: &Scene) {
    let t = s.t;
    let title = if s.remove {
        t.removing
    } else if s.installed.is_some() {
        t.updating
    } else {
        t.installing
    };
    // A smaller header on the left: the list is what matters here.
    c.icon(Rect::new(PAD, 54.0, 56.0, 56.0));
    let x = PAD + 74.0;
    c.text(title, Rect::new(x, 54.0, W - x - PAD, 32.0), 24.0, Weight::Bold, INK, Align::Left);
    c.text(
        if s.remove { t.removing_hint } else { t.installing_hint },
        Rect::new(x, 86.0, W - x - PAD, 24.0),
        14.5,
        Weight::Regular,
        INK2,
        Align::Left,
    );

    let list = step_list(s);
    let row = 30.0;
    let card = Rect::new(PAD, 134.0, W - 2.0 * PAD, list.len() as f32 * row + 24.0);
    glass(c, card);
    for (i, (step, label)) in list.iter().enumerate() {
        let y = card.y + 12.0 + i as f32 * row;
        let (gx, gy) = (card.x + 30.0, y + row / 2.0);
        let state = s.steps[*step as usize];
        match state {
            State::Done => {
                c.fill_circle(gx, gy, 10.0, GREEN);
                check_mark(c, gx, gy, 10.0, 1.0, rgb(0xffffff), 2.0);
            }
            State::Active => {
                c.stroke_circle(gx, gy, 8.5, rgba(0xffffff, 0.12), 2.2);
                c.arc(gx, gy, 8.5, s.clock * 6.6, 4.3, BLUE, 2.2);
            }
            State::Skipped => {
                c.fill_circle(gx, gy, 10.0, rgba(0xffffff, 0.08));
                c.line((gx - 4.0, gy), (gx + 4.0, gy), INK3, 1.8);
            }
            State::Waiting => c.stroke_circle(gx, gy, 9.0, INK4, 1.6),
        }
        let (weight, ink) = match state {
            State::Active => (Weight::SemiBold, INK),
            State::Done => (Weight::Regular, INK),
            _ => (Weight::Regular, INK3),
        };
        c.text(
            label,
            Rect::new(card.x + 54.0, y, card.w - 70.0, row),
            15.0,
            weight,
            ink,
            Align::Left,
        );
    }

    // What is happening now, and the bar.
    let bar = Rect::new(PAD, H - 52.0, W - 2.0 * PAD, 6.0);
    let pct = t.percent.replace("{n}", &((s.progress * 100.0).round() as i32).to_string());
    c.text(
        s.detail,
        Rect::new(PAD, bar.y - 34.0, bar.w - 70.0, 24.0),
        13.0,
        Weight::Regular,
        INK2,
        Align::Left,
    );
    c.text(
        &pct,
        Rect::new(bar.right() - 70.0, bar.y - 34.0, 70.0, 24.0),
        13.0,
        Weight::SemiBold,
        INK2,
        Align::Right,
    );
    c.fill_round(bar, 3.0, rgba(0xffffff, 0.10));
    let fill = Rect::new(bar.x, bar.y, (bar.w * s.progress.clamp(0.0, 1.0)).max(6.0), bar.h);
    c.fill_round_gradient(
        fill,
        3.0,
        (bar.x, 0.0),
        (bar.right(), 0.0),
        &[(0.0, rgb(0x3d9cff)), (1.0, rgb(0x0a84ff))],
    );
}

fn done(c: &Canvas, s: &Scene, hits: &mut Hits) {
    let t = s.t;
    sign(c, s, 98.0, Sign::Check);
    let title = if s.installed.is_some() { t.updated } else { t.done };
    c.text(
        title,
        Rect::new(PAD, 146.0, W - 2.0 * PAD, 36.0),
        26.0,
        Weight::Bold,
        INK,
        Align::Center,
    );
    c.text(
        t.done_hint,
        Rect::new(PAD, 182.0, W - 2.0 * PAD, 24.0),
        15.0,
        Weight::Regular,
        INK2,
        Align::Center,
    );

    let card = Rect::new(PAD, 222.0, W - 2.0 * PAD, 3.0 * 36.0 + 16.0);
    glass(c, card);
    for (i, line) in t.next.iter().enumerate() {
        let y = card.y + 8.0 + i as f32 * 36.0;
        let (nx, ny) = (card.x + 30.0, y + 18.0);
        c.fill_circle(nx, ny, 11.5, rgba(0x0a84ff, 0.20));
        c.text(
            &(i + 1).to_string(),
            Rect::new(nx - 12.0, ny - 12.0, 24.0, 24.0),
            13.0,
            Weight::SemiBold,
            BLUE_SOFT,
            Align::Center,
        );
        c.text(
            line,
            Rect::new(card.x + 54.0, y, card.w - 70.0, 36.0),
            14.5,
            Weight::Regular,
            INK,
            Align::Left,
        );
    }
    actions(
        c,
        s,
        hits,
        &[
            (Hit::Secondary, t.close, Kind::Secondary, true),
            (Hit::Primary, t.open_game, Kind::Primary, true),
        ],
    );
}

fn failed(c: &Canvas, s: &Scene, hits: &mut Hits) {
    let t = s.t;
    let col = W - 2.0 * PAD - 60.0;
    let msg_h = c.g.paragraph_height(s.error, 15.0, Weight::Regular, col);
    let link = (!s.log_path.is_empty()).then(|| t.failed_log.replace("{path}", s.log_path));
    // The sign, title, message and log link as one block in the middle.
    let block = 68.0 + 16.0 + 36.0 + 10.0 + msg_h + if link.is_some() { 14.0 + 22.0 } else { 0.0 };
    let top = TITLE_BAR + ((ACTIONS.y - 16.0 - TITLE_BAR) - block) / 2.0;
    sign(c, s, top + 34.0, Sign::Warning);
    let y = top + 68.0 + 16.0;
    c.text(
        t.failed,
        Rect::new(PAD, y, W - 2.0 * PAD, 36.0),
        26.0,
        Weight::Bold,
        INK,
        Align::Center,
    );
    c.paragraph(
        s.error,
        Rect::new(PAD + 30.0, y + 46.0, col, msg_h + 4.0),
        15.0,
        Weight::Regular,
        INK2,
        Align::Center,
    );
    if let Some(line) = link {
        let r = Rect::new(PAD, y + 46.0 + msg_h + 14.0, W - 2.0 * PAD, 22.0);
        let ink = if s.hover == Some(Hit::Log) { BLUE_SOFT } else { INK3 };
        c.text(&line, r, 12.5, Weight::Regular, ink, Align::Center);
        hits.push((Hit::Log, r));
    }
    actions(
        c,
        s,
        hits,
        &[
            (Hit::Secondary, t.close, Kind::Secondary, true),
            (Hit::Primary, t.retry, Kind::Primary, true),
        ],
    );
}

fn confirm(c: &Canvas, s: &Scene, hits: &mut Hits) {
    let t = s.t;
    let sub = s
        .installed
        .map(|v| t.installed_now.replace("{v}", v))
        .unwrap_or_else(|| t.tagline.to_string());
    hero(c, t.remove_title, &sub);
    let col = W - 2.0 * PAD - 40.0;
    let h = c.g.paragraph_height(t.remove_hint, 15.0, Weight::Regular, col - 44.0);
    let card = Rect::new(PAD + 20.0, 222.0, col, h + 40.0);
    glass(c, card);
    c.paragraph(
        t.remove_hint,
        Rect::new(card.x + 22.0, card.y + 20.0, card.w - 44.0, h + 4.0),
        15.0,
        Weight::Regular,
        INK2,
        Align::Center,
    );
    actions(
        c,
        s,
        hits,
        &[
            (Hit::Secondary, t.cancel, Kind::Secondary, true),
            (Hit::Primary, t.remove, Kind::Danger, true),
        ],
    );
}

fn removed(c: &Canvas, s: &Scene, hits: &mut Hits) {
    let t = s.t;
    sign(c, s, 166.0, Sign::Check);
    c.text(
        t.removed,
        Rect::new(PAD, 220.0, W - 2.0 * PAD, 36.0),
        26.0,
        Weight::Bold,
        INK,
        Align::Center,
    );
    c.text(
        t.removed_hint,
        Rect::new(PAD, 256.0, W - 2.0 * PAD, 24.0),
        15.0,
        Weight::Regular,
        INK2,
        Align::Center,
    );
    actions(c, s, hits, &[(Hit::Primary, t.close, Kind::Primary, true)]);
}
