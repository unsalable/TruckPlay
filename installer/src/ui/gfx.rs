//! Drawing for the window (and for --render's PNG files): Direct2D shapes, DirectWrite text in
//! TruckPlay's own Inter, the TruckPlay icon through WIC. Colours are written straight, the way CSS
//! writes them; `Canvas::fade` dims everything for the screens' entrance.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::path::Path;

use windows::Win32::Foundation::{GENERIC_WRITE, HWND};
use windows::Win32::Graphics::Direct2D::Common::{
    D2D_RECT_F, D2D_SIZE_U, D2D1_ALPHA_MODE_IGNORE, D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_FIGURE_BEGIN_HOLLOW,
    D2D1_FIGURE_END_OPEN, D2D1_GRADIENT_STOP, D2D1_PIXEL_FORMAT,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1_ARC_SEGMENT, D2D1_ARC_SIZE_LARGE, D2D1_ARC_SIZE_SMALL, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, D2D1_CAP_STYLE_ROUND,
    D2D1_DASH_STYLE_SOLID, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_ELLIPSE, D2D1_EXTEND_MODE_CLAMP, D2D1_FACTORY_TYPE_SINGLE_THREADED,
    D2D1_FEATURE_LEVEL_DEFAULT, D2D1_GAMMA_2_2, D2D1_HWND_RENDER_TARGET_PROPERTIES, D2D1_LINE_JOIN_ROUND,
    D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES, D2D1_PRESENT_OPTIONS_NONE, D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES, D2D1_RENDER_TARGET_PROPERTIES,
    D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1_RENDER_TARGET_USAGE_NONE, D2D1_ROUNDED_RECT, D2D1_STROKE_STYLE_PROPERTIES,
    D2D1_SWEEP_DIRECTION_CLOCKWISE, D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE, D2D1CreateFactory, ID2D1Bitmap, ID2D1Factory,
    ID2D1HwndRenderTarget, ID2D1RenderTarget, ID2D1SolidColorBrush, ID2D1StrokeStyle,
};
use windows::Win32::Graphics::DirectWrite::{
    DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_FEATURE, DWRITE_FONT_FEATURE_TAG, DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL,
    DWRITE_FONT_WEIGHT, DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_NEAR, DWRITE_TEXT_ALIGNMENT_CENTER,
    DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_TEXT_ALIGNMENT_TRAILING, DWRITE_TEXT_METRICS, DWRITE_TEXT_RANGE, DWRITE_TRIMMING,
    DWRITE_TRIMMING_GRANULARITY_CHARACTER, DWRITE_WORD_WRAPPING_NO_WRAP, DWRITE_WORD_WRAPPING_WRAP, DWriteCreateFactory, IDWriteFactory,
    IDWriteFactory5, IDWriteFontCollection, IDWriteFontCollection1, IDWriteTextFormat, IDWriteTextLayout, IDWriteTextLayout1,
    IDWriteTypography,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppPBGRA, IWICBitmap, IWICImagingFactory, IWICPalette,
    WICBitmapCacheOnDemand, WICBitmapDitherTypeNone, WICBitmapEncoderNoCache, WICBitmapInterpolationModeHighQualityCubic,
    WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::StructuredStorage::IPropertyBag2;
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
use windows::core::{HSTRING, Interface, Result};
use windows_numerics::{Matrix3x2, Vector2};

pub const ICON_PNG: &[u8] = include_bytes!("../../../plugin/setup/truckplay.png");
const INTER: [&[u8]; 3] = [
    include_bytes!("../../fonts/Inter-Regular.ttf"),
    include_bytes!("../../fonts/Inter-SemiBold.ttf"),
    include_bytes!("../../fonts/Inter-Bold.ttf"),
];
const FAMILY: &str = "TruckPlay Inter";

// ---------- colours and rectangles ----------

#[derive(Clone, Copy, Debug)]
pub struct Rgba(pub f32, pub f32, pub f32, pub f32);

pub const fn rgb(hex: u32) -> Rgba {
    rgba(hex, 1.0)
}

pub const fn rgba(hex: u32, a: f32) -> Rgba {
    Rgba(
        ((hex >> 16) & 0xff) as f32 / 255.0,
        ((hex >> 8) & 0xff) as f32 / 255.0,
        (hex & 0xff) as f32 / 255.0,
        a,
    )
}

impl Rgba {
    pub fn alpha(self, k: f32) -> Rgba {
        Rgba(self.0, self.1, self.2, self.3 * k)
    }

    pub fn mix(self, o: Rgba, t: f32) -> Rgba {
        let l = |a: f32, b: f32| a + (b - a) * t;
        Rgba(l(self.0, o.0), l(self.1, o.1), l(self.2, o.2), l(self.3, o.3))
    }

    fn d2d(self) -> D2D1_COLOR_F {
        D2D1_COLOR_F {
            r: self.0,
            g: self.1,
            b: self.2,
            a: self.3.clamp(0.0, 1.0),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Rect {
        Rect { x, y, w, h }
    }

    pub fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }

    pub fn right(&self) -> f32 {
        self.x + self.w
    }

    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }

    pub fn cx(&self) -> f32 {
        self.x + self.w / 2.0
    }

    pub fn cy(&self) -> f32 {
        self.y + self.h / 2.0
    }

    fn d2d(&self) -> D2D_RECT_F {
        D2D_RECT_F {
            left: self.x,
            top: self.y,
            right: self.x + self.w,
            bottom: self.y + self.h,
        }
    }
}

fn v(x: f32, y: f32) -> Vector2 {
    Vector2 { X: x, Y: y }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Weight {
    Regular,
    SemiBold,
    Bold,
}

impl Weight {
    fn dwrite(self) -> DWRITE_FONT_WEIGHT {
        DWRITE_FONT_WEIGHT(match self {
            Weight::Regular => 400,
            Weight::SemiBold => 600,
            Weight::Bold => 700,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Align {
    Left,
    Center,
    Right,
}

const fn tag(s: &[u8; 4]) -> DWRITE_FONT_FEATURE_TAG {
    DWRITE_FONT_FEATURE_TAG((s[0] as u32) | (s[1] as u32) << 8 | (s[2] as u32) << 16 | (s[3] as u32) << 24)
}

// ---------- shared factories ----------

type FormatKey = (u32, u32, u8, bool);

pub struct Gfx {
    pub d2d: ID2D1Factory,
    dwrite: IDWriteFactory,
    fonts: Option<IDWriteFontCollection1>,
    family: HSTRING,
    locale: HSTRING,
    wic: IWICImagingFactory,
    round: ID2D1StrokeStyle,
    typography: Option<IDWriteTypography>,
    formats: RefCell<Vec<(FormatKey, IDWriteTextFormat)>>,
}

/// TruckPlay's Inter from memory; None on a Windows too old for in-memory fonts (before Windows
/// 10 1703), and the system's font is used instead.
fn load_fonts(dwrite: &IDWriteFactory) -> Option<IDWriteFontCollection1> {
    // SAFETY: COM calls; the font data is static, so it outlives the loader.
    unsafe {
        let f5: IDWriteFactory5 = dwrite.cast().ok()?;
        let loader = f5.CreateInMemoryFontFileLoader().ok()?;
        f5.RegisterFontFileLoader(&loader).ok()?;
        let builder = f5.CreateFontSetBuilder().ok()?;
        for data in INTER {
            let file = loader
                .CreateInMemoryFontFileReference(&f5, data.as_ptr() as *const c_void, data.len() as u32, None)
                .ok()?;
            builder.AddFontFile(&file).ok()?;
        }
        let set = builder.CreateFontSet().ok()?;
        f5.CreateFontCollectionFromFontSet(&set).ok()
    }
}

impl Gfx {
    pub fn new(turkish: bool) -> Result<Gfx> {
        // SAFETY: factory creation and plain COM calls.
        unsafe {
            let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
            let dwrite: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let wic: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            let fonts = load_fonts(&dwrite);
            let family = HSTRING::from(if fonts.is_some() { FAMILY } else { "Segoe UI Variable Text" });
            let round = d2d.CreateStrokeStyle(
                &D2D1_STROKE_STYLE_PROPERTIES {
                    startCap: D2D1_CAP_STYLE_ROUND,
                    endCap: D2D1_CAP_STYLE_ROUND,
                    dashCap: D2D1_CAP_STYLE_ROUND,
                    lineJoin: D2D1_LINE_JOIN_ROUND,
                    miterLimit: 10.0,
                    dashStyle: D2D1_DASH_STYLE_SOLID,
                    dashOffset: 0.0,
                },
                None,
            )?;
            // The UI's own Inter settings: single-storey a (cv11), round quotes (ss03).
            let typography = dwrite.CreateTypography().ok();
            if let Some(t) = &typography {
                for feature in [b"cv11", b"ss03"] {
                    let _ = t.AddFontFeature(DWRITE_FONT_FEATURE {
                        nameTag: tag(feature),
                        parameter: 1,
                    });
                }
            }
            Ok(Gfx {
                d2d,
                dwrite,
                fonts,
                family,
                locale: HSTRING::from(if turkish { "tr-tr" } else { "en-us" }),
                wic,
                round,
                typography,
                formats: RefCell::new(Vec::new()),
            })
        }
    }

    fn format(&self, size: f32, weight: Weight, align: Align, wrap: bool) -> Result<IDWriteTextFormat> {
        let key = (weight.dwrite().0 as u32, (size * 100.0) as u32, align as u8, wrap);
        if let Some((_, f)) = self.formats.borrow().iter().find(|(k, _)| *k == key) {
            return Ok(f.clone());
        }
        // SAFETY: plain DirectWrite calls.
        let format = unsafe {
            let collection: Option<IDWriteFontCollection> = self.fonts.as_ref().and_then(|c| c.cast().ok());
            let f = self.dwrite.CreateTextFormat(
                &self.family,
                collection.as_ref(),
                weight.dwrite(),
                DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                size,
                &self.locale,
            )?;
            f.SetTextAlignment(match align {
                Align::Left => DWRITE_TEXT_ALIGNMENT_LEADING,
                Align::Center => DWRITE_TEXT_ALIGNMENT_CENTER,
                Align::Right => DWRITE_TEXT_ALIGNMENT_TRAILING,
            })?;
            f.SetParagraphAlignment(if wrap {
                DWRITE_PARAGRAPH_ALIGNMENT_NEAR
            } else {
                DWRITE_PARAGRAPH_ALIGNMENT_CENTER
            })?;
            f.SetWordWrapping(if wrap {
                DWRITE_WORD_WRAPPING_WRAP
            } else {
                DWRITE_WORD_WRAPPING_NO_WRAP
            })?;
            if !wrap {
                let sign = self.dwrite.CreateEllipsisTrimmingSign(&f)?;
                f.SetTrimming(
                    &DWRITE_TRIMMING {
                        granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER,
                        delimiter: 0,
                        delimiterCount: 0,
                    },
                    &sign,
                )?;
            }
            f
        };
        self.formats.borrow_mut().push((key, format.clone()));
        Ok(format)
    }

    /// Text laid out in a box: one line (centred vertically, an ellipsis when too long) or wrapped.
    pub fn layout(&self, text: &str, size: f32, weight: Weight, align: Align, wrap: bool, w: f32, h: f32) -> Result<IDWriteTextLayout> {
        let wide: Vec<u16> = text.encode_utf16().collect();
        let format = self.format(size, weight, align, wrap)?;
        // SAFETY: plain DirectWrite calls.
        unsafe {
            let layout = self.dwrite.CreateTextLayout(&wide, &format, w.max(1.0), h.max(1.0))?;
            let range = DWRITE_TEXT_RANGE {
                startPosition: 0,
                length: wide.len() as u32,
            };
            if let Some(t) = &self.typography {
                let _ = layout.SetTypography(t, range);
            }
            // Apple-like tracking: a touch tighter, more so for titles.
            if let Ok(l1) = layout.cast::<IDWriteTextLayout1>() {
                let em = if size >= 22.0 { -0.022 } else { -0.008 };
                let _ = l1.SetCharacterSpacing(0.0, em * size, 0.0, range);
            }
            Ok(layout)
        }
    }

    /// Width and height of one line of text.
    pub fn measure(&self, text: &str, size: f32, weight: Weight) -> (f32, f32) {
        self.layout(text, size, weight, Align::Left, false, 4000.0, size * 2.0)
            .and_then(|l| {
                let mut m = DWRITE_TEXT_METRICS::default();
                // SAFETY: `m` receives the metrics.
                unsafe { l.GetMetrics(&mut m)? };
                Ok((m.widthIncludingTrailingWhitespace, m.height))
            })
            .unwrap_or((text.len() as f32 * size * 0.55, size * 1.2))
    }

    /// Height of text wrapped in a column `w` wide.
    pub fn paragraph_height(&self, text: &str, size: f32, weight: Weight, w: f32) -> f32 {
        self.layout(text, size, weight, Align::Left, true, w, 4000.0)
            .and_then(|l| {
                let mut m = DWRITE_TEXT_METRICS::default();
                // SAFETY: `m` receives the metrics.
                unsafe { l.GetMetrics(&mut m)? };
                Ok(m.height)
            })
            .unwrap_or(size * 1.3)
    }

    pub fn hwnd_target(&self, hwnd: HWND, width: u32, height: u32, dpi: f32) -> Result<ID2D1HwndRenderTarget> {
        let props = D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_IGNORE,
            },
            dpiX: dpi,
            dpiY: dpi,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        };
        let hwnd_props = D2D1_HWND_RENDER_TARGET_PROPERTIES {
            hwnd,
            pixelSize: D2D_SIZE_U {
                width: width.max(1),
                height: height.max(1),
            },
            presentOptions: D2D1_PRESENT_OPTIONS_NONE,
        };
        // SAFETY: plain Direct2D call.
        unsafe {
            let rt = self.d2d.CreateHwndRenderTarget(&props, &hwnd_props)?;
            rt.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
            Ok(rt)
        }
    }

    /// An offscreen picture `w`×`h` pixels at `dpi`, for --render.
    pub fn picture(&self, w: u32, h: u32, dpi: f32) -> Result<(IWICBitmap, ID2D1RenderTarget)> {
        // SAFETY: plain WIC and Direct2D calls.
        unsafe {
            let bitmap = self
                .wic
                .CreateBitmap(w, h, &GUID_WICPixelFormat32bppPBGRA, WICBitmapCacheOnDemand)?;
            let props = D2D1_RENDER_TARGET_PROPERTIES {
                r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
                pixelFormat: D2D1_PIXEL_FORMAT {
                    format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
                },
                dpiX: dpi,
                dpiY: dpi,
                usage: D2D1_RENDER_TARGET_USAGE_NONE,
                minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
            };
            let rt = self.d2d.CreateWicBitmapRenderTarget(&bitmap, &props)?;
            rt.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
            Ok((bitmap, rt))
        }
    }

    pub fn save_png(&self, bitmap: &IWICBitmap, path: &Path) -> Result<()> {
        // SAFETY: plain WIC calls; the frame comes from CreateNewFrame.
        unsafe {
            let (mut w, mut h) = (0, 0);
            bitmap.GetSize(&mut w, &mut h)?;
            let stream = self.wic.CreateStream()?;
            stream.InitializeFromFilename(&HSTRING::from(path.as_os_str()), GENERIC_WRITE.0)?;
            let encoder = self.wic.CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())?;
            encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
            let mut frame = None;
            encoder.CreateNewFrame(&mut frame, std::ptr::null_mut())?;
            let frame = frame.ok_or_else(windows::core::Error::from_thread)?;
            frame.Initialize(None::<&IPropertyBag2>)?;
            frame.SetSize(w, h)?;
            let mut format = GUID_WICPixelFormat32bppPBGRA;
            frame.SetPixelFormat(&mut format)?;
            frame.WriteSource(bitmap, std::ptr::null())?;
            frame.Commit()?;
            encoder.Commit()?;
        }
        Ok(())
    }

    /// The TruckPlay icon at exactly `px` pixels (scaled with WIC's best filter, so it stays crisp).
    pub fn icon(&self, rt: &ID2D1RenderTarget, px: u32) -> Result<ID2D1Bitmap> {
        // SAFETY: plain WIC and Direct2D calls on static PNG data.
        unsafe {
            let stream = self.wic.CreateStream()?;
            stream.InitializeFromMemory(ICON_PNG)?;
            let decoder = self
                .wic
                .CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
            let frame = decoder.GetFrame(0)?;
            let scaler = self.wic.CreateBitmapScaler()?;
            scaler.Initialize(&frame, px.max(1), px.max(1), WICBitmapInterpolationModeHighQualityCubic)?;
            let converter = self.wic.CreateFormatConverter()?;
            converter.Initialize(
                &scaler,
                &GUID_WICPixelFormat32bppPBGRA,
                WICBitmapDitherTypeNone,
                None::<&IWICPalette>,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
            rt.CreateBitmapFromWicBitmap(&converter, None)
        }
    }
}

// ---------- one frame's drawing ----------

pub struct Canvas<'a> {
    pub g: &'a Gfx,
    rt: &'a ID2D1RenderTarget,
    brush: ID2D1SolidColorBrush,
    icon: Option<&'a ID2D1Bitmap>,
    fade: Cell<f32>,
}

impl<'a> Canvas<'a> {
    pub fn new(g: &'a Gfx, rt: &'a ID2D1RenderTarget, icon: Option<&'a ID2D1Bitmap>) -> Result<Canvas<'a>> {
        // SAFETY: plain Direct2D call.
        let brush = unsafe { rt.CreateSolidColorBrush(&rgb(0xffffff).d2d(), None)? };
        Ok(Canvas {
            g,
            rt,
            brush,
            icon,
            fade: Cell::new(1.0),
        })
    }

    /// Everything drawn from now on at this opacity (1 = as given).
    pub fn set_fade(&self, k: f32) {
        self.fade.set(k.clamp(0.0, 1.0));
    }

    /// Everything drawn from now on moved by (dx, dy) and scaled by `s` round (cx, cy).
    pub fn set_transform(&self, dx: f32, dy: f32, s: f32, cx: f32, cy: f32) {
        let m = Matrix3x2::scale_around(s, s, v(cx, cy)) * Matrix3x2::translation(dx, dy);
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.SetTransform(&m) };
    }

    pub fn reset_transform(&self) {
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.SetTransform(&Matrix3x2::identity()) };
    }

    fn solid(&self, c: Rgba) -> &ID2D1SolidColorBrush {
        // SAFETY: plain Direct2D call.
        unsafe { self.brush.SetColor(&c.alpha(self.fade.get()).d2d()) };
        &self.brush
    }

    pub fn clear(&self, c: Rgba) {
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.Clear(Some(&c.d2d())) };
    }

    pub fn fill_round(&self, r: Rect, radius: f32, c: Rgba) {
        let rr = D2D1_ROUNDED_RECT {
            rect: r.d2d(),
            radiusX: radius,
            radiusY: radius,
        };
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.FillRoundedRectangle(&rr, self.solid(c)) };
    }

    pub fn stroke_round(&self, r: Rect, radius: f32, c: Rgba, width: f32) {
        let half = width / 2.0;
        let r = Rect::new(r.x + half, r.y + half, r.w - width, r.h - width);
        let rr = D2D1_ROUNDED_RECT {
            rect: r.d2d(),
            radiusX: (radius - half).max(0.0),
            radiusY: (radius - half).max(0.0),
        };
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.DrawRoundedRectangle(&rr, self.solid(c), width, None) };
    }

    fn stops(&self, stops: &[(f32, Rgba)]) -> Result<windows::Win32::Graphics::Direct2D::ID2D1GradientStopCollection> {
        let fade = self.fade.get();
        let list: Vec<D2D1_GRADIENT_STOP> = stops
            .iter()
            .map(|(p, c)| D2D1_GRADIENT_STOP {
                position: *p,
                color: c.alpha(fade).d2d(),
            })
            .collect();
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.CreateGradientStopCollection(&list, D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP) }
    }

    /// A rounded rectangle filled with a gradient from `from` to `to` (points in DIPs).
    pub fn fill_round_gradient(&self, r: Rect, radius: f32, from: (f32, f32), to: (f32, f32), stops: &[(f32, Rgba)]) {
        let Ok(collection) = self.stops(stops) else { return };
        // SAFETY: plain Direct2D calls.
        unsafe {
            let props = D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES {
                startPoint: v(from.0, from.1),
                endPoint: v(to.0, to.1),
            };
            if let Ok(brush) = self.rt.CreateLinearGradientBrush(&props, None, &collection) {
                let rr = D2D1_ROUNDED_RECT {
                    rect: r.d2d(),
                    radiusX: radius,
                    radiusY: radius,
                };
                self.rt.FillRoundedRectangle(&rr, &brush);
            }
        }
    }

    /// A soft glow: an ellipse fading out from `c` in the middle, over `area`.
    pub fn glow(&self, area: Rect, cx: f32, cy: f32, rx: f32, ry: f32, c: Rgba, reach: f32) {
        let Ok(collection) = self.stops(&[(0.0, c), (reach, c.alpha(0.0)), (1.0, c.alpha(0.0))]) else {
            return;
        };
        // SAFETY: plain Direct2D calls.
        unsafe {
            let props = D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES {
                center: v(cx, cy),
                gradientOriginOffset: v(0.0, 0.0),
                radiusX: rx,
                radiusY: ry,
            };
            if let Ok(brush) = self.rt.CreateRadialGradientBrush(&props, None, &collection) {
                self.rt.FillRectangle(&area.d2d(), &brush);
            }
        }
    }

    pub fn fill_circle(&self, cx: f32, cy: f32, radius: f32, c: Rgba) {
        let e = D2D1_ELLIPSE {
            point: v(cx, cy),
            radiusX: radius,
            radiusY: radius,
        };
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.FillEllipse(&e, self.solid(c)) };
    }

    pub fn stroke_circle(&self, cx: f32, cy: f32, radius: f32, c: Rgba, width: f32) {
        let e = D2D1_ELLIPSE {
            point: v(cx, cy),
            radiusX: radius,
            radiusY: radius,
        };
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.DrawEllipse(&e, self.solid(c), width, None) };
    }

    pub fn line(&self, a: (f32, f32), b: (f32, f32), c: Rgba, width: f32) {
        // SAFETY: plain Direct2D call.
        unsafe { self.rt.DrawLine(v(a.0, a.1), v(b.0, b.1), self.solid(c), width, &self.g.round) };
    }

    /// An open path through `points`, with round ends and joins (the check mark).
    pub fn polyline(&self, points: &[(f32, f32)], c: Rgba, width: f32) {
        if points.len() < 2 {
            return;
        }
        // SAFETY: plain Direct2D calls; the sink is closed before drawing.
        unsafe {
            let Ok(path) = self.g.d2d.CreatePathGeometry() else { return };
            let Ok(sink) = path.Open() else { return };
            sink.BeginFigure(v(points[0].0, points[0].1), D2D1_FIGURE_BEGIN_HOLLOW);
            for p in &points[1..] {
                sink.AddLine(v(p.0, p.1));
            }
            sink.EndFigure(D2D1_FIGURE_END_OPEN);
            if sink.Close().is_ok() {
                self.rt.DrawGeometry(&path, self.solid(c), width, &self.g.round);
            }
        }
    }

    /// An arc round (cx, cy) from `start` through `sweep` radians, clockwise (0 = up).
    pub fn arc(&self, cx: f32, cy: f32, radius: f32, start: f32, sweep: f32, c: Rgba, width: f32) {
        let at = |a: f32| v(cx + radius * a.sin(), cy - radius * a.cos());
        let sweep = sweep.clamp(0.01, std::f32::consts::TAU - 0.01);
        // SAFETY: plain Direct2D calls; the sink is closed before drawing.
        unsafe {
            let Ok(path) = self.g.d2d.CreatePathGeometry() else { return };
            let Ok(sink) = path.Open() else { return };
            sink.BeginFigure(at(start), D2D1_FIGURE_BEGIN_HOLLOW);
            sink.AddArc(&D2D1_ARC_SEGMENT {
                point: at(start + sweep),
                size: windows::Win32::Graphics::Direct2D::Common::D2D_SIZE_F {
                    width: radius,
                    height: radius,
                },
                rotationAngle: 0.0,
                sweepDirection: D2D1_SWEEP_DIRECTION_CLOCKWISE,
                arcSize: if sweep > std::f32::consts::PI {
                    D2D1_ARC_SIZE_LARGE
                } else {
                    D2D1_ARC_SIZE_SMALL
                },
            });
            sink.EndFigure(D2D1_FIGURE_END_OPEN);
            if sink.Close().is_ok() {
                self.rt.DrawGeometry(&path, self.solid(c), width, &self.g.round);
            }
        }
    }

    /// One line of text in `r` (centred vertically; an ellipsis if it does not fit).
    pub fn text(&self, s: &str, r: Rect, size: f32, weight: Weight, c: Rgba, align: Align) {
        if let Ok(layout) = self.g.layout(s, size, weight, align, false, r.w, r.h) {
            // SAFETY: plain Direct2D call.
            unsafe {
                self.rt
                    .DrawTextLayout(v(r.x, r.y), &layout, self.solid(c), D2D1_DRAW_TEXT_OPTIONS_NONE)
            };
        }
    }

    /// Text wrapped in a column `r.w` wide, from the top of `r`. Returns its height.
    pub fn paragraph(&self, s: &str, r: Rect, size: f32, weight: Weight, c: Rgba, align: Align) -> f32 {
        let Ok(layout) = self.g.layout(s, size, weight, align, true, r.w, r.h.max(size * 2.0)) else {
            return 0.0;
        };
        let mut m = DWRITE_TEXT_METRICS::default();
        // SAFETY: plain DirectWrite and Direct2D calls.
        unsafe {
            let _ = layout.GetMetrics(&mut m);
            self.rt
                .DrawTextLayout(v(r.x, r.y), &layout, self.solid(c), D2D1_DRAW_TEXT_OPTIONS_NONE);
        }
        m.height
    }

    /// The TruckPlay icon in `r`, with a soft shadow under it.
    pub fn icon(&self, r: Rect) {
        for (i, a) in [(1.0, 0.10), (2.0, 0.07), (3.0, 0.05)] {
            let grow = i * 2.0;
            self.fill_round(
                Rect::new(
                    r.x - grow + 1.0,
                    r.y - grow + 4.0 + i * 2.0,
                    r.w + grow * 2.0 - 2.0,
                    r.h + grow * 2.0 - 2.0,
                ),
                r.w * 0.3,
                rgba(0x000000, a),
            );
        }
        if let Some(bitmap) = self.icon {
            // SAFETY: plain Direct2D call.
            unsafe {
                self.rt
                    .DrawBitmap(bitmap, Some(&r.d2d()), self.fade.get(), D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, None)
            };
        } else {
            self.fill_round(r, r.w * 0.27, rgb(0x0a84ff));
        }
    }
}
