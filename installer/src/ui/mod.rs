//! The installer's window: small, dark and soft, in TruckPlay's own look, with its own title bar.
//! The work runs on a thread of its own and tells the window how it goes (Shared); the window draws
//! only while something moves (an entrance, a spinner, the bar), so at rest it costs nothing.

mod draw;
mod gfx;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use windows::Win32::Foundation::{D2DERR_RECREATE_TARGET, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Direct2D::Common::D2D_SIZE_U;
use windows::Win32::Graphics::Direct2D::{ID2D1Bitmap, ID2D1HwndRenderTarget, ID2D1RenderTarget};
use windows::Win32::Graphics::Dwm::{
    DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmExtendFrameIntoClientArea, DwmSetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, InvalidateRect, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint, ScreenToClient, ValidateRect,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Controls::{MARGINS, WM_MOUSELEAVE};
use windows::Win32::UI::HiDpi::{GetDpiForSystem, GetDpiForWindow};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    ReleaseCapture, SetCapture, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent, VK_ESCAPE, VK_RETURN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CREATESTRUCTW, CS_HREDRAW, CS_VREDRAW, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GWLP_USERDATA, GetCursorPos,
    GetMessageW, GetWindowLongPtrW, HTCAPTION, HTCLIENT, IDC_ARROW, IDC_HAND, KillTimer, LoadCursorW, LoadIconW, MSG, PostMessageW,
    PostQuitMessage, RegisterClassExW, SW_MINIMIZE, SW_SHOW, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SetCursor,
    SetForegroundWindow, SetTimer, SetWindowLongPtrW, SetWindowPos, ShowWindow, TranslateMessage, WM_APP, WM_CLOSE, WM_DESTROY,
    WM_DPICHANGED, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_NCCALCSIZE, WM_NCCREATE, WM_NCHITTEST, WM_PAINT,
    WM_SETCURSOR, WM_SIZE, WM_TIMER, WNDCLASSEXW, WS_CAPTION, WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU,
};
use windows::core::{BOOL, HSTRING, PCWSTR, w};

use crate::engine::{self, Failure, Report, State, Step};
use crate::log::Log;
use crate::payload::Payload;
use crate::places::{self, Places};
use crate::sys;
use crate::text::Text;
use draw::{H, Hit, Phase, Scene, W};
use gfx::{Canvas, Gfx};

pub struct Install {
    pub places: Places,
    pub payload: Payload,
    pub game: Option<PathBuf>,
    pub no_map: bool,
}

pub struct Remove {
    pub places: Places,
    pub game: Option<PathBuf>,
}

enum Work {
    Install(Arc<Install>),
    Remove(Arc<Remove>),
}

/// What the work thread tells the window.
struct Shared {
    phase: Phase,
    steps: [State; 6],
    progress: f32,
    detail: String,
    error: String,
    cancel: bool,
}

const WM_POKE: u32 = WM_APP + 1;
const TIMER: usize = 1;
const STEAM_RUN_ETS2: &str = "steam://rungameid/227300";

struct UiReport {
    shared: Arc<Mutex<Shared>>,
    hwnd: isize,
    log: Arc<Log>,
}

impl UiReport {
    fn poke(&self) {
        // SAFETY: posting to our own window from the work thread is what PostMessage is for.
        unsafe {
            let _ = PostMessageW(Some(HWND(self.hwnd as *mut _)), WM_POKE, WPARAM(0), LPARAM(0));
        }
    }

    fn with(&self, f: impl FnOnce(&mut Shared)) {
        if let Ok(mut s) = self.shared.lock() {
            f(&mut s);
        }
    }

    fn finish(&self, result: Result<(), Failure>, t: &Text, done: Phase) {
        self.with(|s| match &result {
            Ok(()) => s.phase = done,
            Err(Failure::Cancelled) => s.phase = if done == Phase::Removed { Phase::Confirm } else { Phase::Welcome },
            Err(e) => {
                s.phase = Phase::Failed;
                s.error = e.note(t);
            }
        });
        if let Err(e) = &result {
            self.log.line(&format!("Bitti: {}", e.note(t)));
        }
        self.poke();
    }
}

impl Report for UiReport {
    fn step(&self, step: Step, state: State) {
        self.with(|s| s.steps[step as usize] = state);
    }
    fn progress(&self, fraction: f32) {
        self.with(|s| s.progress = fraction);
    }
    fn detail(&self, text: &str) {
        self.with(|s| {
            s.detail.clear();
            s.detail.push_str(text);
        });
    }
    fn log(&self, line: &str) {
        self.log.line(line);
    }
    fn game_open(&self, open: bool) {
        self.with(|s| s.phase = if open { Phase::Waiting } else { Phase::Working });
        self.poke();
    }
    fn cancelled(&self) -> bool {
        self.shared.lock().map(|s| s.cancel).unwrap_or(false)
    }
}

struct App {
    hwnd: HWND,
    t: &'static Text,
    work: Work,
    shared: Arc<Mutex<Shared>>,
    log: Arc<Log>,
    gfx: Gfx,
    target: Option<(ID2D1HwndRenderTarget, Option<ID2D1Bitmap>)>,
    dpi: u32,
    phase: Phase,
    phase_at: Instant,
    opened: Instant,
    last: Instant,
    shown: f32,
    hits: Vec<(Hit, gfx::Rect)>,
    hover: Option<Hit>,
    pressed: Option<Hit>,
    tracking: bool,
    timer: bool,
    game: Option<PathBuf>,
    game_text: String,
    game_note: Option<&'static str>,
    installed: Option<String>,
    exit: i32,
}

fn scale(dpi: u32) -> f32 {
    dpi as f32 / 96.0
}

impl App {
    fn remove(&self) -> bool {
        matches!(self.work, Work::Remove(_))
    }

    fn can_close(&self) -> bool {
        self.phase != Phase::Working
    }

    fn invalidate(&self) {
        // SAFETY: our own window.
        unsafe {
            let _ = InvalidateRect(Some(self.hwnd), None, false);
        }
    }

    fn set_timer(&mut self, on: bool) {
        if on == self.timer {
            return;
        }
        self.timer = on;
        // SAFETY: our own window's timer.
        unsafe {
            if on {
                SetTimer(Some(self.hwnd), TIMER, 15, None);
            } else {
                let _ = KillTimer(Some(self.hwnd), TIMER);
            }
        }
    }

    fn sync(&mut self) -> (Phase, [State; 6], f32, String, String) {
        let s = self.shared.lock().expect("shared state");
        (s.phase, s.steps, s.progress, s.detail.clone(), s.error.clone())
    }

    fn paint(&mut self) {
        let now = Instant::now();
        let dt = (now - self.last).as_secs_f32().min(0.1);
        self.last = now;
        let (phase, steps, progress, detail, error) = self.sync();
        if phase != self.phase {
            self.phase = phase;
            self.phase_at = now;
            self.pressed = None;
        }
        // The bar eases toward the work's figure (and jumps back for a new try).
        if progress < self.shown {
            self.shown = progress;
        } else {
            self.shown += (progress - self.shown) * (1.0 - (-dt / 0.2).exp());
        }
        if self.target.is_none() {
            self.make_target();
        }
        let Some((rt, icon)) = &self.target else { return };
        let age = (now - self.phase_at).as_secs_f32();
        let version = engine::VERSION;
        let log_path = self.log.path.display().to_string();
        let scene = Scene {
            t: self.t,
            remove: self.remove(),
            phase,
            age,
            clock: (now - self.opened).as_secs_f32(),
            steps,
            progress: self.shown,
            detail: &detail,
            error: &error,
            game: self.game.as_ref().map(|_| self.game_text.as_str()),
            game_note: self.game_note,
            installed: self.installed.as_deref(),
            same: self.installed.as_deref() == Some(version),
            version,
            log_path: &log_path,
            hover: self.hover,
            pressed: self.pressed,
        };
        let target: &ID2D1RenderTarget = rt;
        // SAFETY: drawing on our own render target between BeginDraw and EndDraw.
        let ended = unsafe {
            target.BeginDraw();
            if let Ok(canvas) = Canvas::new(&self.gfx, target, icon.as_ref()) {
                self.hits = draw::draw(&canvas, &scene);
            }
            target.EndDraw(None, None)
        };
        if let Err(e) = ended
            && e.code() == D2DERR_RECREATE_TARGET
        {
            self.target = None;
        }
        let moving = age < 1.2 || matches!(phase, Phase::Working | Phase::Waiting) || (progress - self.shown).abs() > 0.001;
        self.set_timer(moving);
    }

    fn make_target(&mut self) {
        let mut rc = RECT::default();
        // SAFETY: our own window.
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(self.hwnd, &mut rc);
        }
        let (w, h) = ((rc.right - rc.left) as u32, (rc.bottom - rc.top) as u32);
        let dpi = self.dpi as f32;
        if let Ok(rt) = self.gfx.hwnd_target(self.hwnd, w, h, dpi) {
            let px = (60.0 * scale(self.dpi)).round() as u32;
            let icon = self.gfx.icon(&rt, px).ok();
            self.target = Some((rt, icon));
        }
    }

    fn resize(&mut self, w: u32, h: u32) {
        if let Some((rt, _)) = &self.target {
            // SAFETY: our own render target.
            if unsafe {
                rt.Resize(&D2D_SIZE_U {
                    width: w.max(1),
                    height: h.max(1),
                })
            }
            .is_err()
            {
                self.target = None;
            }
        }
        self.invalidate();
    }

    /// The button under a point in window pixels.
    fn hit_at(&self, x: i32, y: i32) -> Option<Hit> {
        let k = scale(self.dpi);
        let (x, y) = (x as f32 / k, y as f32 / k);
        self.hits.iter().rev().find(|(_, r)| r.contains(x, y)).map(|(h, _)| *h)
    }

    fn start(&mut self) {
        if let Ok(mut s) = self.shared.lock() {
            s.phase = Phase::Working;
            s.steps = [State::Waiting; 6];
            s.progress = 0.0;
            s.detail.clear();
            s.error.clear();
            s.cancel = false;
        }
        self.shown = 0.0;
        let report = UiReport {
            shared: self.shared.clone(),
            hwnd: self.hwnd.0 as isize,
            log: self.log.clone(),
        };
        let t = self.t;
        match &self.work {
            Work::Install(inst) => {
                let inst = inst.clone();
                let game = self.game.clone();
                std::thread::spawn(move || {
                    let job = engine::Job {
                        places: &inst.places,
                        game,
                        update: false,
                        no_map: inst.no_map,
                        text: t,
                    };
                    let result = engine::install(&job, &inst.payload, &report);
                    report.finish(result, t, Phase::Done);
                });
            }
            Work::Remove(rem) => {
                let rem = rem.clone();
                std::thread::spawn(move || {
                    let job = engine::Job {
                        places: &rem.places,
                        game: rem.game.clone(),
                        update: false,
                        no_map: false,
                        text: t,
                    };
                    let result = engine::uninstall(&job, &report);
                    report.finish(result, t, Phase::Removed);
                });
            }
        }
        self.invalidate();
    }

    fn close(&mut self) {
        // SAFETY: our own window.
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }

    fn pick_game(&mut self) {
        if let Some(dir) = sys::pick_folder(self.hwnd, self.t.pick_title) {
            if crate::game::is_game(&dir) {
                self.game_text = dir.display().to_string();
                self.game = Some(dir);
                self.game_note = None;
            } else {
                self.game_note = Some(self.t.not_a_game);
            }
            self.invalidate();
        }
    }

    fn click(&mut self, hit: Hit) {
        match (self.phase, hit) {
            (_, Hit::Minimize) => unsafe {
                // SAFETY: our own window.
                let _ = ShowWindow(self.hwnd, SW_MINIMIZE);
            },
            (Phase::Working, Hit::Close) => {}
            (Phase::Waiting, Hit::Close | Hit::Secondary) => {
                if let Ok(mut s) = self.shared.lock() {
                    s.cancel = true;
                }
            }
            (_, Hit::Close) => self.close(),
            (Phase::Welcome, Hit::Primary) if self.game.is_some() && self.game_note.is_none() => self.start(),
            (Phase::Welcome, Hit::Folder) => self.pick_game(),
            (Phase::Confirm, Hit::Primary) => self.start(),
            (Phase::Confirm, Hit::Secondary) => self.close(),
            (Phase::Done, Hit::Primary) => {
                sys::open(STEAM_RUN_ETS2);
                self.close();
            }
            (Phase::Done | Phase::Removed, _) => self.close(),
            (Phase::Failed, Hit::Primary) => self.start(),
            (Phase::Failed, Hit::Secondary) => {
                self.exit = 1;
                self.close();
            }
            (Phase::Failed, Hit::Log) => sys::open(&self.log.path.display().to_string()),
            _ => {}
        }
    }

    fn handle(&mut self, msg: u32, wparam: WPARAM, lparam: LPARAM) -> Option<LRESULT> {
        let point = || ((lparam.0 & 0xffff) as i16 as i32, ((lparam.0 >> 16) & 0xffff) as i16 as i32);
        match msg {
            // The whole window is ours to draw: no system caption or border (both forms of the
            // message: the client area is the window's own rectangle, left as it is).
            WM_NCCALCSIZE => Some(LRESULT(0)),
            WM_NCHITTEST => {
                let mut p = POINT {
                    x: point().0,
                    y: point().1,
                };
                // SAFETY: our own window.
                unsafe {
                    let _ = ScreenToClient(self.hwnd, &mut p);
                }
                let over_button = self.hit_at(p.x, p.y).is_some();
                let k = scale(self.dpi);
                Some(LRESULT(if !over_button && (p.y as f32) < draw::TITLE_BAR * k {
                    HTCAPTION as isize
                } else {
                    HTCLIENT as isize
                }))
            }
            WM_PAINT => {
                self.paint();
                // SAFETY: our own window.
                unsafe {
                    let _ = ValidateRect(Some(self.hwnd), None);
                }
                Some(LRESULT(0))
            }
            WM_SIZE => {
                self.resize((lparam.0 & 0xffff) as u32, ((lparam.0 >> 16) & 0xffff) as u32);
                Some(LRESULT(0))
            }
            WM_DPICHANGED => {
                self.dpi = ((wparam.0 >> 16) & 0xffff) as u32;
                // SAFETY: Windows hands us the rectangle it suggests for the new DPI.
                unsafe {
                    let r = &*(lparam.0 as *const RECT);
                    let _ = SetWindowPos(
                        self.hwnd,
                        None,
                        r.left,
                        r.top,
                        r.right - r.left,
                        r.bottom - r.top,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                }
                self.target = None;
                self.invalidate();
                Some(LRESULT(0))
            }
            WM_MOUSEMOVE => {
                if !self.tracking {
                    let mut tme = TRACKMOUSEEVENT {
                        cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: self.hwnd,
                        dwHoverTime: 0,
                    };
                    // SAFETY: plain call with a filled-in structure.
                    unsafe {
                        let _ = TrackMouseEvent(&mut tme);
                    }
                    self.tracking = true;
                }
                let (x, y) = point();
                let hover = self.hit_at(x, y);
                if hover != self.hover {
                    self.hover = hover;
                    self.invalidate();
                }
                Some(LRESULT(0))
            }
            WM_MOUSELEAVE => {
                self.tracking = false;
                if self.hover.take().is_some() {
                    self.invalidate();
                }
                Some(LRESULT(0))
            }
            WM_LBUTTONDOWN => {
                let (x, y) = point();
                self.pressed = self.hit_at(x, y);
                // SAFETY: our own window.
                unsafe { SetCapture(self.hwnd) };
                self.invalidate();
                Some(LRESULT(0))
            }
            WM_LBUTTONUP => {
                // SAFETY: plain call.
                unsafe {
                    let _ = ReleaseCapture();
                }
                let (x, y) = point();
                let hit = self.hit_at(x, y);
                let pressed = self.pressed.take();
                self.invalidate();
                if let Some(h) = hit.filter(|h| Some(*h) == pressed) {
                    self.click(h);
                }
                Some(LRESULT(0))
            }
            WM_SETCURSOR => {
                let mut p = POINT::default();
                // SAFETY: plain calls on our own window.
                unsafe {
                    let _ = GetCursorPos(&mut p);
                    let _ = ScreenToClient(self.hwnd, &mut p);
                    let cursor = if self.hit_at(p.x, p.y).is_some() { IDC_HAND } else { IDC_ARROW };
                    if let Ok(c) = LoadCursorW(None, cursor) {
                        SetCursor(Some(c));
                    }
                }
                Some(LRESULT(1))
            }
            WM_KEYDOWN => {
                let key = wparam.0 as u16;
                let want = if key == VK_RETURN.0 {
                    Some(Hit::Primary)
                } else if key == VK_ESCAPE.0 {
                    Some(Hit::Close)
                } else {
                    None
                };
                if let Some(h) = want.filter(|h| self.hits.iter().any(|(x, _)| x == h) || *h == Hit::Close) {
                    self.click(h);
                }
                Some(LRESULT(0))
            }
            WM_TIMER => {
                self.invalidate();
                Some(LRESULT(0))
            }
            WM_POKE => {
                self.invalidate();
                Some(LRESULT(0))
            }
            WM_CLOSE => {
                if self.phase == Phase::Waiting {
                    self.click(Hit::Close);
                } else if self.can_close() {
                    self.close();
                }
                Some(LRESULT(0))
            }
            WM_DESTROY => {
                // SAFETY: plain call.
                unsafe { PostQuitMessage(self.exit) };
                Some(LRESULT(0))
            }
            _ => None,
        }
    }
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // SAFETY: GWLP_USERDATA holds the App this window was created with (WM_NCCREATE), which
    // outlives the window (run() keeps it until the message loop ends).
    unsafe {
        if msg == WM_NCCREATE {
            let cs = &*(lparam.0 as *const CREATESTRUCTW);
            let app = cs.lpCreateParams as *mut App;
            (*app).hwnd = hwnd;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, app as isize);
        }
        let app = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut App;
        if !app.is_null()
            && let Some(result) = (*app).handle(msg, wparam, lparam)
        {
            return result;
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

fn run(work: Work, t: &'static Text, phase: Phase, game: Option<PathBuf>, installed: Option<String>, log: Log) -> i32 {
    let _com = sys::Com::init();
    let Ok(gfx) = Gfx::new(std::ptr::eq(t, &crate::text::TR)) else {
        return 1;
    };
    let now = Instant::now();
    let game_text = game.as_ref().map(|g| g.display().to_string()).unwrap_or_default();
    let mut app = Box::new(App {
        hwnd: HWND::default(),
        t,
        work,
        shared: Arc::new(Mutex::new(Shared {
            phase,
            steps: [State::Waiting; 6],
            progress: 0.0,
            detail: String::new(),
            error: String::new(),
            cancel: false,
        })),
        log: Arc::new(log),
        gfx,
        target: None,
        dpi: 96,
        phase,
        phase_at: now,
        opened: now,
        last: now,
        shown: 0.0,
        hits: Vec::new(),
        hover: None,
        pressed: None,
        tracking: false,
        timer: false,
        game,
        game_text,
        game_note: None,
        installed,
        exit: 0,
    });
    // SAFETY: the window procedure reaches `app` through GWLP_USERDATA; it lives on this stack
    // frame until the message loop below has ended.
    unsafe {
        let Ok(module) = GetModuleHandleW(PCWSTR::null()) else { return 1 };
        let instance = module.into();
        let class = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: instance,
            hIcon: LoadIconW(Some(instance), PCWSTR(std::ptr::without_provenance(1))).unwrap_or_default(),
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            lpszClassName: w!("TruckPlaySetup"),
            ..Default::default()
        };
        RegisterClassExW(&class);
        // Centred on the screen the mouse is on, sized for its DPI.
        let mut cursor = POINT::default();
        let _ = GetCursorPos(&mut cursor);
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(monitor, &mut info);
        let k = scale(GetDpiForSystem());
        let (w, h) = ((W * k).round() as i32, (H * k).round() as i32);
        let work_area = info.rcWork;
        let (x, y) = (
            (work_area.left + work_area.right - w) / 2,
            (work_area.top + work_area.bottom - h) / 2,
        );
        let title = HSTRING::from(if matches!(app.work, Work::Remove(_)) {
            t.remove_window_title
        } else {
            t.window_title
        });
        let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
        let app_ptr: *mut App = &mut *app;
        let Ok(hwnd) = CreateWindowExW(
            Default::default(),
            w!("TruckPlaySetup"),
            &title,
            style,
            x,
            y,
            w,
            h,
            None,
            None,
            Some(instance),
            Some(app_ptr as *const _),
        ) else {
            return 1;
        };
        // Its real DPI may differ from the system's (another monitor): size it again for that.
        app.dpi = GetDpiForWindow(hwnd).max(96);
        let k = scale(app.dpi);
        let (w2, h2) = ((W * k).round() as i32, (H * k).round() as i32);
        // SWP_FRAMECHANGED: the frame is measured again, without the caption this time.
        let _ = SetWindowPos(
            hwnd,
            None,
            (work_area.left + work_area.right - w2) / 2,
            (work_area.top + work_area.bottom - h2) / 2,
            w2,
            h2,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
        // Dark frame, round corners on Windows 11, and the system's shadow kept.
        let dark = BOOL(1);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark as *const _ as *const _,
            size_of::<BOOL>() as u32,
        );
        let round = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &round as *const _ as *const _,
            size_of_val(&round) as u32,
        );
        let _ = DwmExtendFrameIntoClientArea(
            hwnd,
            &MARGINS {
                cxLeftWidth: 0,
                cxRightWidth: 0,
                cyTopHeight: 0,
                cyBottomHeight: 1,
            },
        );
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = SetForegroundWindow(hwnd);

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    }
    let failed = app.phase == Phase::Failed;
    if failed { 1 } else { app.exit }
}

pub fn install_window(inst: Install, t: &'static Text) -> i32 {
    let installed = places::is_install_dir(&inst.places.install)
        .then(|| places::installed_version(&inst.places.install))
        .flatten();
    let game = inst.game.clone();
    let log = Log::create(inst.places.temp.join("TruckPlay-kurulum.log"));
    run(Work::Install(Arc::new(inst)), t, Phase::Welcome, game, installed, log)
}

pub fn remove_window(rem: Remove, t: &'static Text) -> i32 {
    let installed = places::installed_version(&rem.places.install);
    let game = rem.game.clone();
    let log = Log::create(rem.places.temp.join("TruckPlay-kaldirma.log"));
    run(Work::Remove(Arc::new(rem)), t, Phase::Confirm, game, installed, log)
}

/// For developers: every screen as a PNG (2x), Turkish and English, into `dir`.
pub fn render_screens(dir: &Path, t: &'static Text) -> i32 {
    let _com = sys::Com::init();
    let _ = std::fs::create_dir_all(dir);
    let Ok(gfx) = Gfx::new(std::ptr::eq(t, &crate::text::TR)) else {
        return 1;
    };
    let k = 2.0;
    let (pw, ph) = ((W * k) as u32, (H * k) as u32);
    let game = r"F:\SteamLibrary\steamapps\common\Euro Truck Simulator 2";
    // The README's pictures leave the version out (TRUCKPLAY_SETUP_RENDER_VERSION=""): it would date them.
    let version_text = std::env::var("TRUCKPLAY_SETUP_RENDER_VERSION").unwrap_or_else(|_| engine::VERSION.to_string());
    let version: &str = &version_text;
    let steps = [State::Done, State::Done, State::Done, State::Active, State::Waiting, State::Waiting];
    let removing = [State::Waiting, State::Done, State::Active, State::Done, State::Waiting, State::Done];
    let shots: Vec<(&str, Scene)> = {
        let base = move |phase, age: f32| Scene {
            t,
            remove: false,
            phase,
            age,
            clock: 0.35,
            steps,
            progress: 0.62,
            detail: t.detail_mod,
            error: "",
            game: Some(game),
            game_note: None,
            installed: None,
            same: false,
            version,
            log_path: "",
            hover: None,
            pressed: None,
        };
        let mut v = vec![
            ("1-welcome", base(Phase::Welcome, 5.0)),
            (
                "2-welcome-update",
                Scene {
                    installed: Some("1.8.0"),
                    hover: Some(Hit::Primary),
                    ..base(Phase::Welcome, 5.0)
                },
            ),
            (
                "3-welcome-no-game",
                Scene {
                    game: None,
                    ..base(Phase::Welcome, 5.0)
                },
            ),
            ("4-waiting", base(Phase::Waiting, 5.0)),
            ("5-working", base(Phase::Working, 5.0)),
            ("6-done", base(Phase::Done, 5.0)),
            (
                "7-failed",
                Scene {
                    error: t.err_plugin,
                    log_path: r"C:\Users\oyuncu\AppData\Local\Temp\TruckPlay-kurulum.log",
                    ..base(Phase::Failed, 5.0)
                },
            ),
            (
                "8-remove",
                Scene {
                    remove: true,
                    installed: Some(engine::VERSION),
                    ..base(Phase::Confirm, 5.0)
                },
            ),
        ];
        v.push((
            "9-removing",
            Scene {
                remove: true,
                steps: removing,
                progress: 0.4,
                detail: "",
                ..base(Phase::Working, 5.0)
            },
        ));
        v.push((
            "10-removed",
            Scene {
                remove: true,
                ..base(Phase::Removed, 5.0)
            },
        ));
        v
    };
    for (name, scene) in shots {
        let Ok((bitmap, rt)) = gfx.picture(pw, ph, 96.0 * k) else {
            return 1;
        };
        let icon = gfx.icon(&rt, (60.0 * k) as u32).ok();
        // SAFETY: drawing on our own render target between BeginDraw and EndDraw.
        unsafe {
            rt.BeginDraw();
            if let Ok(canvas) = Canvas::new(&gfx, &rt, icon.as_ref()) {
                draw::draw(&canvas, &scene);
            }
            if rt.EndDraw(None, None).is_err() {
                return 1;
            }
        }
        let lang = if std::ptr::eq(t, &crate::text::TR) { "tr" } else { "en" };
        if gfx.save_png(&bitmap, &dir.join(format!("{lang}-{name}.png"))).is_err() {
            return 1;
        }
    }
    0
}
