#include "d3d_hooks.h"

#include <d3d11.h>
#include <dxgi1_2.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <mutex>
#include <vector>

#include "frames.h"
#include "input.h"
#include "json.h"
#include "log.h"
#include "overlay.h"
#include "pipe.h"
#include "pointer.h"
#include "telemetry.h"
#include "vhook.h"

namespace tp::d3d {
namespace {

using PresentFn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT);
using Present1Fn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain1*, UINT, UINT, const DXGI_PRESENT_PARAMETERS*);
using ResizeBuffersFn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT, UINT, DXGI_FORMAT, UINT);
using CreateTexture2DFn = HRESULT(STDMETHODCALLTYPE*)(ID3D11Device*, const D3D11_TEXTURE2D_DESC*,
                                                       const D3D11_SUBRESOURCE_DATA*, ID3D11Texture2D**);
using CreateSrvFn = HRESULT(STDMETHODCALLTYPE*)(ID3D11Device*, ID3D11Resource*, const D3D11_SHADER_RESOURCE_VIEW_DESC*,
                                                ID3D11ShaderResourceView**);
using PsSetSrvFn = void(STDMETHODCALLTYPE*)(ID3D11DeviceContext*, UINT, UINT, ID3D11ShaderResourceView* const*);
using OmSetRtFn = void(STDMETHODCALLTYPE*)(ID3D11DeviceContext*, UINT, ID3D11RenderTargetView* const*,
                                           ID3D11DepthStencilView*);
using OmSetRtUavFn = void(STDMETHODCALLTYPE*)(ID3D11DeviceContext*, UINT, ID3D11RenderTargetView* const*,
                                              ID3D11DepthStencilView*, UINT, UINT, ID3D11UnorderedAccessView* const*,
                                              const UINT*);

VHook g_present, g_present1, g_resize, g_createTex, g_createSrv, g_psSetSrv, g_omSetRt, g_omSetRtUav;

// Marker textures are created by the game (often on loader threads); everything else runs in Present.
struct Marker {
  ID3D11Texture2D* tex;
  UINT w, h;
  DXGI_FORMAT fmt;
};
std::mutex g_markersMu;
std::vector<Marker> g_markers;
uint64_t g_markerSerial = 0;

// The route advisor's panel marker: the game shows it stretched over the panel; we draw the
// composed frame into it (so it is created as a render target too).
struct AdvisorMarker {
  ID3D11Texture2D* tex;
  ID3D11RenderTargetView* rtv;
  UINT w, h;
  bool srgb;
  ULONG ours;  // references we hold (the texture's and the view's)
};
std::vector<AdvisorMarker> g_advisors;  // under g_markersMu
std::atomic<bool> g_advisorOn{false};
std::atomic<bool> g_advisorStale{false};

ID3D11Device* g_device = nullptr;
ID3D11DeviceContext* g_ctx = nullptr;
IDXGISwapChain* g_swap = nullptr;

// Our copy of the latest frame. The UI frame lands in g_frameTex first; g_compTex is that frame
// with the pointer drawn on top, and the markers (and the big view) get GPU copies of it.
ID3D11Texture2D* g_frameTex = nullptr;
ID3D11ShaderResourceView* g_frameSrv[2] = {};  // [0] UNORM, [1] UNORM_SRGB
ID3D11Texture2D* g_compTex = nullptr;
ID3D11ShaderResourceView* g_compSrv[2] = {};
ID3D11RenderTargetView* g_compRtv = nullptr;
UINT g_frameW = 0, g_frameH = 0;
uint64_t g_lastSeq = 0;
std::atomic<bool> g_forceFull{true};
std::atomic<bool> g_markersStale{false};  // a marker appeared: give it the whole composed frame

// Layers the host draws for us to lay over the game's picture (the HUD card over the road, the
// windshield HUD): our copy of each one's newest frame.
struct Layer {
  frames::Channel& (*channel)();
  const char* name;
  ID3D11Texture2D* tex = nullptr;
  ID3D11ShaderResourceView* srv[2] = {};
  UINT w = 0, h = 0;
  uint64_t seq = 0;
  bool forceFull = true;
};
Layer g_hud{frames::Hud, "hud"};
Layer g_wind{frames::Wind, "wind"};
std::atomic<bool> g_hudBottom{false};

// The windshield HUD: the driver's setting, and how much of it shows now (it fades in and out
// with the cab view; the card over the road gives way to it there).
std::atomic<bool> g_windOn{false};
std::atomic<float> g_windDrop{6.5f};
float g_windCab = 0;   // 0…1: on, in the cab view
float g_windLook = 0;  // 0…1: as seen from where the driver looks

// Is the cab drawn this frame? The GPS script draws our marker into the cab screen's render
// target, and the cab's screen samples that target when the interior is drawn — not in the
// outside cameras. Watching the binds of those views tells which view the driver has.
struct View {
  ID3D11Resource* res;  // not owned
  ID3D11ShaderResourceView* srv;
  bool marker;
};
std::mutex g_viewsMu;  // views are created on loader threads too
std::vector<View> g_views;
std::atomic<bool> g_viewsChanged{false};
struct Watch {
  ID3D11ShaderResourceView* srv[8];
  uint8_t kind[8];  // 0: a marker, 1: the cab screen's target
  UINT count;
};
Watch g_watch{};                                // rebuilt in Present, read by the hook (both on the render thread)
ID3D11RenderTargetView* g_boundRtv = nullptr;   // the render target being drawn into now (not owned)
ID3D11Resource* g_cabTarget = nullptr;          // the cab screen's render target (owned)
uint64_t g_markerSeen = 0, g_cabSeen = 0;       // frame numbers
bool g_cabWas = false;
// The size of the game's picture, as last told to the host.
std::atomic<UINT> g_viewW{0}, g_viewH{0};

// Where the pointer was drawn last frame, so it can be erased.
bool g_pointerDrawn = false;
D3D11_BOX g_pointerBox{};
pointer::Shape g_pointerShape{};

LARGE_INTEGER g_qpf{}, g_lastQpc{}, g_statsQpc{};
uint64_t g_frames = 0, g_uploads = 0, g_uploadBytes = 0, g_framesAtStats = 0;
thread_local int g_depth = 0;
thread_local bool g_ownCreate = false;  // our own textures must not be mistaken for markers

bool IsBgra(DXGI_FORMAT f) {
  return f == DXGI_FORMAT_B8G8R8A8_UNORM || f == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB || f == DXGI_FORMAT_B8G8R8A8_TYPELESS;
}

std::string ScreenJsonLocked() {
  JsonWriter w;
  w.beginObject().str("t", "screen");
  if (g_markers.empty()) {
    w.integer("w", 0).integer("h", 0);
  } else {
    const Marker& m = g_markers.back();
    w.integer("w", m.w).integer("h", m.h).integer("fmt", m.fmt);
  }
  w.integer("count", static_cast<long long>(g_markers.size())).integer("serial", static_cast<long long>(g_markerSerial));
  w.endObject();
  return w.text();
}

bool IsSrgbFormat(DXGI_FORMAT f) { return f == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB; }

// The route advisor's panel marker: kept, and made a render target we draw the frame into.
HRESULT CreateAdvisor(ID3D11Device* dev, const D3D11_TEXTURE2D_DESC* desc, const D3D11_SUBRESOURCE_DATA* init,
                      ID3D11Texture2D** out, CreateTexture2DFn original) {
  D3D11_TEXTURE2D_DESC d = *desc;
  d.Usage = D3D11_USAGE_DEFAULT;
  d.CPUAccessFlags = 0;
  d.MipLevels = 1;
  d.BindFlags |= D3D11_BIND_RENDER_TARGET;
  d.MiscFlags &= ~(D3D11_RESOURCE_MISC_GENERATE_MIPS | D3D11_RESOURCE_MISC_TEXTURECUBE);
  const HRESULT hr = original(dev, &d, init, out);
  if (FAILED(hr) || !*out) {
    TPLOG("advisor texture: create failed hr=0x%08lx", hr);
    return hr;
  }
  D3D11_RENDER_TARGET_VIEW_DESC rv{};
  rv.Format = d.Format == DXGI_FORMAT_B8G8R8A8_TYPELESS ? DXGI_FORMAT_B8G8R8A8_UNORM : d.Format;
  rv.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2D;
  ID3D11RenderTargetView* rtv = nullptr;
  g_ownCreate = true;
  dev->CreateRenderTargetView(*out, &rv, &rtv);
  g_ownCreate = false;
  if (!rtv) {
    TPLOG("advisor texture: no render target view (fmt %d)", d.Format);
    return hr;
  }
  (*out)->AddRef();
  (*out)->AddRef();
  const ULONG refs = (*out)->Release();  // the game's, ours and the view's
  {
    std::lock_guard lock(g_markersMu);
    g_advisors.push_back({*out, rtv, d.Width, d.Height, IsSrgbFormat(rv.Format), refs - 1});
  }
  g_advisorStale = true;
  TPLOG("advisor texture captured: %ux%u fmt=%d", d.Width, d.Height, d.Format);
  return hr;
}

HRESULT STDMETHODCALLTYPE HkCreateTexture2D(ID3D11Device* dev, const D3D11_TEXTURE2D_DESC* desc,
                                            const D3D11_SUBRESOURCE_DATA* init, ID3D11Texture2D** out) {
  const auto original = reinterpret_cast<CreateTexture2DFn>(g_createTex.original);
  if (!g_ownCreate && desc && out && desc->Width == kAdvisorWidth && desc->Height == kAdvisorHeight &&
      desc->ArraySize == 1 && desc->SampleDesc.Count == 1 && IsBgra(desc->Format) &&
      (desc->BindFlags & D3D11_BIND_SHADER_RESOURCE)) {
    return CreateAdvisor(dev, desc, init, out, original);
  }
  if (g_ownCreate || !desc || !out || desc->Width != kMarkerWidth || desc->ArraySize != 1 || desc->SampleDesc.Count != 1) {
    return original(dev, desc, init, out);
  }
  TPLOG("texture %ux%u fmt=%d usage=%d bind=0x%x cpu=0x%x misc=0x%x mips=%u init=%d", desc->Width, desc->Height,
        desc->Format, desc->Usage, desc->BindFlags, desc->CPUAccessFlags, desc->MiscFlags, desc->MipLevels, init != nullptr);
  const bool shaderTexture = desc->Usage == D3D11_USAGE_IMMUTABLE || desc->Usage == D3D11_USAGE_DEFAULT;
  if (!IsBgra(desc->Format) || !shaderTexture || !(desc->BindFlags & D3D11_BIND_SHADER_RESOURCE)) {
    return original(dev, desc, init, out);
  }
  D3D11_TEXTURE2D_DESC d = *desc;
  d.Usage = D3D11_USAGE_DEFAULT;  // so we can write into it every frame
  d.CPUAccessFlags = 0;
  d.MipLevels = 1;
  d.MiscFlags &= ~(D3D11_RESOURCE_MISC_GENERATE_MIPS | D3D11_RESOURCE_MISC_TEXTURECUBE);
  const HRESULT hr = original(dev, &d, init, out);
  if (FAILED(hr) || !*out) {
    TPLOG("marker texture: create failed hr=0x%08lx", hr);
    return hr;
  }
  (*out)->AddRef();
  std::string screen;
  {
    std::lock_guard lock(g_markersMu);
    g_markers.push_back({*out, d.Width, d.Height, d.Format});
    ++g_markerSerial;
    screen = ScreenJsonLocked();
  }
  g_forceFull = true;
  g_markersStale = true;
  TPLOG("marker texture captured: %ux%u fmt=%d", d.Width, d.Height, d.Format);
  input::SetScreenAspect(static_cast<float>(d.Width) / static_cast<float>(d.Height));
  pipe::Send(screen);
  return hr;
}

// ---- which view the driver has (see g_views) ----

bool IsMarker(ID3D11Resource* res) {
  std::lock_guard lock(g_markersMu);
  for (const Marker& m : g_markers)
    if (m.tex == res) return true;
  return false;
}

HRESULT STDMETHODCALLTYPE HkCreateShaderResourceView(ID3D11Device* dev, ID3D11Resource* res,
                                                     const D3D11_SHADER_RESOURCE_VIEW_DESC* desc,
                                                     ID3D11ShaderResourceView** out) {
  const HRESULT hr = reinterpret_cast<CreateSrvFn>(g_createSrv.original)(dev, res, desc, out);
  if (FAILED(hr) || g_ownCreate || !res || !out || !*out) return hr;
  D3D11_RESOURCE_DIMENSION dim{};
  res->GetType(&dim);
  if (dim != D3D11_RESOURCE_DIMENSION_TEXTURE2D) return hr;
  // Our markers, and textures that are render targets (the cab screen's is one): few of each.
  const bool marker = IsMarker(res);
  if (!marker) {
    D3D11_TEXTURE2D_DESC d{};
    static_cast<ID3D11Texture2D*>(res)->GetDesc(&d);
    if (!(d.BindFlags & D3D11_BIND_RENDER_TARGET)) return hr;
  }
  std::lock_guard lock(g_viewsMu);
  if (g_views.size() >= 4096) g_views.erase(g_views.begin(), g_views.begin() + 1024);  // stale ones, long released
  g_views.push_back({res, *out, marker});
  g_viewsChanged = true;
  return hr;
}

void Seen(uint8_t kind) {
  if (kind == 1) {
    g_cabSeen = g_frames;
    return;
  }
  g_markerSeen = g_frames;
  if (g_cabTarget || !g_boundRtv) return;
  // The first time the marker is drawn: into the cab screen's render target.
  g_boundRtv->GetResource(&g_cabTarget);
  g_viewsChanged = true;
  TPLOG("cab view: the GPS screen draws into %p", static_cast<void*>(g_cabTarget));
}

void STDMETHODCALLTYPE HkPSSetShaderResources(ID3D11DeviceContext* ctx, UINT start, UINT n,
                                              ID3D11ShaderResourceView* const* views) {
  const UINT count = g_watch.count;
  if (count && views && ctx == g_ctx) {
    for (UINT i = 0; i < n; ++i) {
      ID3D11ShaderResourceView* v = views[i];
      if (!v) continue;
      for (UINT k = 0; k < count; ++k) {
        if (g_watch.srv[k] == v) {
          Seen(g_watch.kind[k]);
          break;
        }
      }
    }
  }
  reinterpret_cast<PsSetSrvFn>(g_psSetSrv.original)(ctx, start, n, views);
}

void STDMETHODCALLTYPE HkOMSetRenderTargets(ID3D11DeviceContext* ctx, UINT n, ID3D11RenderTargetView* const* rtvs,
                                            ID3D11DepthStencilView* dsv) {
  if (ctx == g_ctx) g_boundRtv = n && rtvs ? rtvs[0] : nullptr;
  reinterpret_cast<OmSetRtFn>(g_omSetRt.original)(ctx, n, rtvs, dsv);
}

void STDMETHODCALLTYPE HkOMSetRenderTargetsAndUavs(ID3D11DeviceContext* ctx, UINT n, ID3D11RenderTargetView* const* rtvs,
                                                   ID3D11DepthStencilView* dsv, UINT uavStart, UINT uavs,
                                                   ID3D11UnorderedAccessView* const* uav, const UINT* counts) {
  if (ctx == g_ctx && n != D3D11_KEEP_RENDER_TARGETS_AND_DEPTH_STENCIL) g_boundRtv = n && rtvs ? rtvs[0] : nullptr;
  reinterpret_cast<OmSetRtUavFn>(g_omSetRtUav.original)(ctx, n, rtvs, dsv, uavStart, uavs, uav, counts);
}

// The views worth watching: the markers', then the cab screen target's once it is known.
void RebuildWatch() {
  if (!g_viewsChanged.exchange(false)) return;
  Watch w{};
  std::lock_guard lock(g_viewsMu);
  for (auto it = g_views.rbegin(); it != g_views.rend() && w.count < 8; ++it) {
    if (it->marker || (g_cabTarget && it->res == g_cabTarget)) {
      w.srv[w.count] = it->srv;
      w.kind[w.count++] = it->marker ? 0 : 1;
    }
  }
  if (w.count != g_watch.count) TPLOG("cab view: watching %u view(s)", w.count);
  g_watch = w;
}

// In the cab view this frame: the cab screen's target was sampled (the cab was drawn). Until it
// has been seen once, the marker being drawn at all stands in (the test cab draws it straight on).
bool CabInView() {
  const bool cab = g_cabSeen ? g_frames - g_cabSeen <= 1 : g_markerSeen && g_frames - g_markerSeen <= 1;
  if (cab != g_cabWas) {
    g_cabWas = cab;
    TPLOG("cab view: %s", cab ? "in" : "out");
  }
  return cab;
}

// Drop markers only we still reference (the game destroyed them, e.g. after leaving the truck).
void PruneMarkers() {
  std::string screen;
  {
    std::lock_guard lock(g_markersMu);
    bool changed = false;
    for (size_t i = 0; i < g_markers.size();) {
      g_markers[i].tex->AddRef();
      const ULONG refs = g_markers[i].tex->Release();
      if (refs <= 1) {
        TPLOG("marker texture released by the game: %ux%u", g_markers[i].w, g_markers[i].h);
        g_markers[i].tex->Release();
        g_markers.erase(g_markers.begin() + static_cast<ptrdiff_t>(i));
        changed = true;
      } else {
        ++i;
      }
    }
    if (changed) {
      ++g_markerSerial;
      screen = ScreenJsonLocked();
    }
    for (size_t i = 0; i < g_advisors.size();) {
      AdvisorMarker& a = g_advisors[i];
      a.tex->AddRef();
      if (a.tex->Release() <= a.ours) {
        TPLOG("advisor texture released by the game");
        a.rtv->Release();
        a.tex->Release();
        g_advisors.erase(g_advisors.begin() + static_cast<ptrdiff_t>(i));
      } else {
        ++i;
      }
    }
  }
  if (!screen.empty()) pipe::Send(screen);
}

template <typename T>
void SafeRelease(T*& p) {
  if (p) p->Release();
  p = nullptr;
}

void ReleaseFrameTexture() {
  for (auto*& srv : g_frameSrv) SafeRelease(srv);
  for (auto*& srv : g_compSrv) SafeRelease(srv);
  SafeRelease(g_compRtv);
  SafeRelease(g_compTex);
  SafeRelease(g_frameTex);
  g_frameW = g_frameH = 0;
  g_pointerDrawn = false;
}

ID3D11Texture2D* CreateFrameTexture(UINT w, UINT h, UINT bind, ID3D11ShaderResourceView* srv[2]) {
  D3D11_TEXTURE2D_DESC d{};
  d.Width = w;
  d.Height = h;
  d.MipLevels = 1;
  d.ArraySize = 1;
  d.Format = DXGI_FORMAT_B8G8R8A8_TYPELESS;
  d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT;
  d.BindFlags = bind;
  ID3D11Texture2D* tex = nullptr;
  g_ownCreate = true;
  const HRESULT created = g_device->CreateTexture2D(&d, nullptr, &tex);
  if (FAILED(created)) {
    g_ownCreate = false;
    return nullptr;
  }
  D3D11_SHADER_RESOURCE_VIEW_DESC v{};
  v.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
  v.Texture2D.MipLevels = 1;
  v.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  g_device->CreateShaderResourceView(tex, &v, &srv[0]);
  v.Format = DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;
  g_device->CreateShaderResourceView(tex, &v, &srv[1]);
  g_ownCreate = false;
  return tex;
}

bool EnsureFrameTexture(UINT w, UINT h) {
  if (g_frameTex && g_compTex && g_frameW == w && g_frameH == h) return true;
  ReleaseFrameTexture();
  g_frameTex = CreateFrameTexture(w, h, D3D11_BIND_SHADER_RESOURCE, g_frameSrv);
  g_compTex = CreateFrameTexture(w, h, D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET, g_compSrv);
  if (g_compTex) {
    D3D11_RENDER_TARGET_VIEW_DESC rv{};
    rv.Format = DXGI_FORMAT_B8G8R8A8_UNORM;  // UI pixels are sRGB-encoded; blend them as the browser did
    rv.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2D;
    g_device->CreateRenderTargetView(g_compTex, &rv, &g_compRtv);
  }
  if (!g_frameTex || !g_compTex || !g_compRtv) {
    TPLOG("frame texture: create %ux%u failed", w, h);
    ReleaseFrameTexture();
    return false;
  }
  g_frameW = w;
  g_frameH = h;
  g_forceFull = true;
  g_markersStale = true;
  TPLOG("frame texture %ux%u ready", w, h);
  return true;
}

// Brings the newest UI frame into g_frameTex and g_compTex. Returns the changed area, if any.
bool UploadFrame(D3D11_BOX* changed) {
  frames::Frame f;
  if (!frames::Latest(g_lastSeq, &f)) return false;
  if (!EnsureFrameTexture(f.width, f.height)) return false;
  D3D11_BOX box{f.dirtyX, f.dirtyY, 0, f.dirtyX + f.dirtyW, f.dirtyY + f.dirtyH, 1};
  if (g_forceFull) box = {0, 0, 0, f.width, f.height, 1};
  const uint8_t* src = f.pixels + static_cast<size_t>(box.top) * f.stride + static_cast<size_t>(box.left) * 4;
  g_ctx->UpdateSubresource(g_frameTex, 0, &box, src, f.stride, 0);
  g_ctx->CopySubresourceRegion(g_compTex, 0, box.left, box.top, 0, g_frameTex, 0, &box);
  g_lastSeq = f.seq;
  g_forceFull = !frames::StillIntact(f);  // torn while copying: next frame goes in whole
  ++g_uploads;
  g_uploadBytes += static_cast<uint64_t>(box.right - box.left) * (box.bottom - box.top) * 4;
  *changed = box;
  return true;
}

void ReleaseLayer(Layer& l) {
  for (auto*& srv : l.srv) SafeRelease(srv);
  SafeRelease(l.tex);
  l.w = l.h = 0;
  l.forceFull = true;
}

// Brings the layer's newest frame into its texture. True while there is a frame to draw.
bool UploadLayer(Layer& l) {
  frames::Channel& ch = l.channel();
  if (!ch.Open()) return false;
  frames::Frame f;
  if (ch.Latest(l.seq, &f)) {
    if (!l.tex || l.w != f.width || l.h != f.height) {
      ReleaseLayer(l);
      l.tex = CreateFrameTexture(f.width, f.height, D3D11_BIND_SHADER_RESOURCE, l.srv);
      if (!l.tex) {
        TPLOG("%s texture: create %ux%u failed", l.name, f.width, f.height);
        return false;
      }
      l.w = f.width;
      l.h = f.height;
      TPLOG("%s texture %ux%u ready", l.name, f.width, f.height);
    }
    D3D11_BOX box{f.dirtyX, f.dirtyY, 0, f.dirtyX + f.dirtyW, f.dirtyY + f.dirtyH, 1};
    if (l.forceFull) box = {0, 0, 0, f.width, f.height, 1};
    const uint8_t* src = f.pixels + static_cast<size_t>(box.top) * f.stride + static_cast<size_t>(box.left) * 4;
    g_ctx->UpdateSubresource(l.tex, 0, &box, src, f.stride, 0);
    l.seq = f.seq;
    l.forceFull = !ch.StillIntact(f);
  }
  return l.tex != nullptr;
}

std::string ViewJsonOf(UINT w, UINT h) {
  JsonWriter j;
  j.beginObject().str("t", "view").integer("w", w).integer("h", h).endObject();
  return j.text();
}

bool Overlaps(const D3D11_BOX& a, const D3D11_BOX& b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

D3D11_BOX PointerBounds(const pointer::Shape& s, float rim) {
  const float m = rim + 2.0f + s.ring * rim * 14.0f;  // a focus ring casts its shadow outside
  const float l = std::floor(s.cx - s.hw - m), t = std::floor(s.cy - s.hh - m);
  const float r = std::ceil(s.cx + s.hw + m), b = std::ceil(s.cy + s.hh + m);
  D3D11_BOX box{};
  box.left = static_cast<UINT>(std::clamp(l, 0.0f, static_cast<float>(g_frameW)));
  box.top = static_cast<UINT>(std::clamp(t, 0.0f, static_cast<float>(g_frameH)));
  box.right = static_cast<UINT>(std::clamp(r, 0.0f, static_cast<float>(g_frameW)));
  box.bottom = static_cast<UINT>(std::clamp(b, 0.0f, static_cast<float>(g_frameH)));
  box.back = 1;
  return box;
}

bool SameShape(const pointer::Shape& a, const pointer::Shape& b) {
  auto same = [](float x, float y) { return std::fabs(x - y) < 0.02f; };
  return same(a.cx, b.cx) && same(a.cy, b.cy) && same(a.hw, b.hw) && same(a.hh, b.hh) && same(a.radius, b.radius) &&
         std::fabs(a.alpha - b.alpha) < 0.002f && std::fabs(a.ring - b.ring) < 0.002f;
}

// Composes this frame's screen: the UI frame plus the pointer at the mouse position of *this*
// game frame, then hands the changed areas to the marker textures.
bool Compose(float dt, const D3D11_BOX* uploaded) {
  if (!g_frameTex || !g_compTex) return false;
  D3D11_BOX boxes[3];
  int count = 0;
  if (uploaded) boxes[count++] = *uploaded;

  const input::PointerState in = input::Pointer();
  const pointer::Shape s = pointer::Update(dt, in.interacting, in.x, in.y, in.pressed);
  const float rim = std::max(0.6f, g_frameH / 721.0f * 0.9f);
  const bool visible = s.alpha > 0.0f && s.hw > 0.5f && s.hh > 0.5f;
  const bool covered = uploaded && g_pointerDrawn && Overlaps(*uploaded, g_pointerBox);
  const bool changed = visible != g_pointerDrawn || (visible && !SameShape(s, g_pointerShape)) || covered;
  if (changed) {
    if (g_pointerDrawn) {
      g_ctx->CopySubresourceRegion(g_compTex, 0, g_pointerBox.left, g_pointerBox.top, 0, g_frameTex, 0, &g_pointerBox);
      boxes[count++] = g_pointerBox;
      g_pointerDrawn = false;
    }
    if (visible) {
      const D3D11_BOX box = PointerBounds(s, rim);
      if (box.right > box.left && box.bottom > box.top) {
        overlay::DrawPointer(g_ctx, g_compRtv, g_frameSrv[0], box, s, rim);
        boxes[count++] = box;
        g_pointerBox = box;
        g_pointerDrawn = true;
      }
    }
    g_pointerShape = s;
  }

  const bool all = g_markersStale.exchange(false);
  if (!count && !all) return false;
  const D3D11_BOX full{0, 0, 0, g_frameW, g_frameH, 1};
  std::lock_guard lock(g_markersMu);
  for (const Marker& m : g_markers) {
    if (m.w != g_frameW || m.h != g_frameH) continue;
    if (all) {
      g_ctx->CopySubresourceRegion(m.tex, 0, 0, 0, 0, g_compTex, 0, &full);
      continue;
    }
    for (int i = 0; i < count; ++i) {
      g_ctx->CopySubresourceRegion(m.tex, 0, boxes[i].left, boxes[i].top, 0, g_compTex, 0, &boxes[i]);
    }
  }
  return true;
}

// The route advisor's panel: the composed frame, drawn again whenever it changed (or clear).
void UpdateAdvisors(bool changed) {
  const bool stale = g_advisorStale.exchange(false);
  if (!changed && !stale) return;
  const bool on = g_advisorOn && g_compTex;
  std::lock_guard lock(g_markersMu);
  for (const AdvisorMarker& a : g_advisors) {
    if (on) {
      overlay::DrawFit(g_ctx, a.rtv, a.w, a.h, a.srgb, g_compSrv, g_frameW, g_frameH, kAdvisorAspect, a.h * 0.045f, 1.0f);
    } else {
      const float clear[4] = {0, 0, 0, 0};
      g_ctx->ClearRenderTargetView(a.rtv, clear);
    }
  }
}

// ---- the windshield HUD ----

// Where its image shows on the picture: a fixed spot in the cab, 2.4 m ahead of the driver's
// eyes and a few degrees below the line of sight, like a real truck's projected image; seen
// from wherever the head is now. `look` fades it as the driver looks away (a real one is only
// seen from the seat, looking ahead).
struct WindPlace {
  bool ok;
  float x, y, scale, look;
};

WindPlace PlaceWind(float vw, float vh) {
  constexpr float kPi = 3.14159265f;
  constexpr float kDistance = 2.4f;
  constexpr float kVerticalFov = 50.0f * kPi / 180.0f;  // the game's default cab camera, near enough
  const float drop = std::clamp(g_windDrop.load(), 0.0f, 20.0f) * kPi / 180.0f;
  float dx = 0, dy = -kDistance * std::tan(drop), dz = -kDistance;  // from the default eye point; -z is ahead
  float h = 0, p = 0, r = 0;
  HeadPose head;
  if (TelemetryHead(&head)) {
    dx -= head.dx;
    dy -= head.dy;
    dz -= head.dz;
    h = head.heading * 2 * kPi;
    p = head.pitch * 2 * kPi;
    r = head.roll * 2 * kPi;
  }
  // Into the head's own frame: undo its heading (about y), pitch (about x), then roll (about z).
  const float x1 = std::cos(h) * dx - std::sin(h) * dz, z1 = std::sin(h) * dx + std::cos(h) * dz, y1 = dy;
  const float y2 = std::cos(p) * y1 + std::sin(p) * z1, z2 = -std::sin(p) * y1 + std::cos(p) * z1, x2 = x1;
  const float x3 = std::cos(r) * x2 + std::sin(r) * y2, y3 = -std::sin(r) * x2 + std::cos(r) * y2, z3 = z2;
  if (z3 > -0.3f) return {false, 0, 0, 0, 0};
  const float f = vh * 0.5f / std::tan(kVerticalFov * 0.5f);
  const float ax = std::atan2(x3, -z3), ay = std::atan2(y3, -z3);
  // Looking more than ~18° away from it (beyond its usual place below the line of sight), it fades.
  const float away = std::sqrt(ax * ax + (ay + drop) * (ay + drop)) * 180.0f / kPi;
  const float look = std::clamp((26.0f - away) / 8.0f, 0.0f, 1.0f);
  return {true, vw * 0.5f + f * (x3 / -z3), vh * 0.5f - f * (y3 / -z3), kDistance / -z3, look};
}

void OnPresent(IDXGISwapChain* sc) {
  if (!g_device) {
    ID3D11Device* dev = nullptr;
    if (FAILED(sc->GetDevice(__uuidof(ID3D11Device), reinterpret_cast<void**>(&dev))) || !dev) return;
    g_device = dev;
    g_device->GetImmediateContext(&g_ctx);
    g_swap = sc;
    DXGI_SWAP_CHAIN_DESC sd{};
    sc->GetDesc(&sd);
    TPLOG("present: swap chain %ux%u fmt=%d buffers=%u windowed=%d effect=%d hwnd=%p", sd.BufferDesc.Width,
          sd.BufferDesc.Height, sd.BufferDesc.Format, sd.BufferCount, sd.Windowed, sd.SwapEffect, sd.OutputWindow);
    input::Attach(sd.OutputWindow);
    overlay::Init(g_device);
    // The game's own context: its class (and vtable) can differ from a throwaway device's, so its
    // view binds are watched right on it.
    void** ctxVt = *reinterpret_cast<void***>(g_ctx);
    const bool watching = PatchVtable(ctxVt, 8, reinterpret_cast<void*>(&HkPSSetShaderResources), g_psSetSrv) &&
                          PatchVtable(ctxVt, 33, reinterpret_cast<void*>(&HkOMSetRenderTargets), g_omSetRt) &&
                          PatchVtable(ctxVt, 34, reinterpret_cast<void*>(&HkOMSetRenderTargetsAndUavs), g_omSetRtUav);
    TPLOG("cab view: %s", watching ? "watching the context's binds" : "cannot watch the context (no windshield HUD)");
    QueryPerformanceFrequency(&g_qpf);
    QueryPerformanceCounter(&g_lastQpc);
    g_statsQpc = g_lastQpc;
  }
  if (sc != g_swap) return;

  LARGE_INTEGER now;
  QueryPerformanceCounter(&now);
  float dt = static_cast<float>(now.QuadPart - g_lastQpc.QuadPart) / static_cast<float>(g_qpf.QuadPart);
  g_lastQpc = now;
  if (dt < 0 || dt > 0.1f) dt = 0.1f;
  ++g_frames;

  if (g_frames % 120 == 0) PruneMarkers();
  input::OnFrame(dt);
  RebuildWatch();
  const bool cab = CabInView();
  D3D11_BOX changed{};
  const bool uploaded = UploadFrame(&changed);
  UpdateAdvisors(Compose(dt, uploaded ? &changed : nullptr));

  const float open = input::BigAmount();
  if (open > 0.001f && g_compTex) overlay::Draw(sc, g_ctx, g_compSrv, g_frameW, g_frameH, open);

  // The game's picture size: the host sizes the HUD to it.
  DXGI_SWAP_CHAIN_DESC sd{};
  if (SUCCEEDED(sc->GetDesc(&sd)) && (sd.BufferDesc.Width != g_viewW || sd.BufferDesc.Height != g_viewH)) {
    g_viewW = sd.BufferDesc.Width;
    g_viewH = sd.BufferDesc.Height;
    pipe::Send(ViewJsonOf(sd.BufferDesc.Width, sd.BufferDesc.Height));
  }
  // The HUDs, when the host wants them shown — never over the game's menus or its pause, nor
  // under the big view. In the cab view the windshield HUD (if on) takes the card's place.
  const bool clear = pipe::Connected() && !TelemetryPaused() && !input::MenuOpen() && open < 0.02f;
  const bool wind = UploadLayer(g_wind) && frames::Wind().Visible() && g_windOn && clear && cab;
  const float step = std::min(1.0f, dt * 9.0f);
  g_windCab += ((wind ? 1.0f : 0.0f) - g_windCab) * step;
  if (g_windCab > 0.003f) {
    const WindPlace at = PlaceWind(static_cast<float>(g_viewW), static_cast<float>(g_viewH));
    g_windLook += ((at.ok ? at.look : 0.0f) - g_windLook) * step;
    const float alpha = g_windCab * g_windLook;
    if (at.ok && alpha > 0.003f) overlay::DrawLayer(sc, g_ctx, g_wind.srv, g_wind.w, g_wind.h, at.x, at.y, at.scale, alpha);
  } else {
    g_windCab = 0;
  }
  if (UploadLayer(g_hud) && frames::Hud().Visible() && clear && g_windCab < 0.997f) {
    overlay::DrawHud(sc, g_ctx, g_hud.srv, g_hud.w, g_hud.h, g_hudBottom, 1.0f - g_windCab);
  }

  if (now.QuadPart - g_statsQpc.QuadPart > g_qpf.QuadPart * 5) {
    const double secs = static_cast<double>(now.QuadPart - g_statsQpc.QuadPart) / static_cast<double>(g_qpf.QuadPart);
    JsonWriter w;
    w.beginObject().str("t", "stats").num("fps", static_cast<double>(g_frames - g_framesAtStats) / secs);
    w.integer("uploads", static_cast<long long>(g_uploads)).integer("uploadKB", static_cast<long long>(g_uploadBytes >> 10));
    w.raw("input", input::StatsJson());
    w.boolean("cab", cab);
    HeadPose head;
    if (TelemetryHead(&head)) {
      w.beginObject("head").num("dx", head.dx, 3).num("dy", head.dy, 3).num("dz", head.dz, 3);
      w.num("h", head.heading, 4).num("p", head.pitch, 4).endObject();
    }
    w.endObject();
    pipe::Send(w.text());
    g_statsQpc = now;
    g_framesAtStats = g_frames;
  }
}

HRESULT STDMETHODCALLTYPE HkPresent(IDXGISwapChain* sc, UINT sync, UINT flags) {
  if (g_depth++ == 0 && !(flags & DXGI_PRESENT_TEST)) OnPresent(sc);
  const HRESULT hr = reinterpret_cast<PresentFn>(g_present.original)(sc, sync, flags);
  --g_depth;
  return hr;
}

HRESULT STDMETHODCALLTYPE HkPresent1(IDXGISwapChain1* sc, UINT sync, UINT flags, const DXGI_PRESENT_PARAMETERS* p) {
  if (g_depth++ == 0 && !(flags & DXGI_PRESENT_TEST)) OnPresent(sc);
  const HRESULT hr = reinterpret_cast<Present1Fn>(g_present1.original)(sc, sync, flags, p);
  --g_depth;
  return hr;
}

HRESULT STDMETHODCALLTYPE HkResizeBuffers(IDXGISwapChain* sc, UINT count, UINT w, UINT h, DXGI_FORMAT fmt, UINT flags) {
  if (sc == g_swap) overlay::ReleaseTarget();
  const HRESULT hr = reinterpret_cast<ResizeBuffersFn>(g_resize.original)(sc, count, w, h, fmt, flags);
  if (sc == g_swap) TPLOG("swap chain resized to %ux%u (hr=0x%08lx)", w, h, hr);
  return hr;
}

}  // namespace

bool Install() {
  WNDCLASSEXW wc{sizeof wc};
  wc.lpfnWndProc = DefWindowProcW;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"TruckPlayProbe";
  RegisterClassExW(&wc);
  HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"", WS_OVERLAPPEDWINDOW, 0, 0, 64, 64, nullptr, nullptr, wc.hInstance, nullptr);

  DXGI_SWAP_CHAIN_DESC sd{};
  sd.BufferCount = 2;
  sd.BufferDesc.Width = 64;
  sd.BufferDesc.Height = 64;
  sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  sd.OutputWindow = hwnd;
  sd.SampleDesc.Count = 1;
  sd.Windowed = TRUE;
  sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;

  IDXGISwapChain* sc = nullptr;
  ID3D11Device* dev = nullptr;
  ID3D11DeviceContext* ctx = nullptr;
  HRESULT hr = E_FAIL;
  for (const D3D_DRIVER_TYPE type : {D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP}) {
    hr = D3D11CreateDeviceAndSwapChain(nullptr, type, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &sd, &sc, &dev, nullptr, &ctx);
    if (SUCCEEDED(hr)) break;
  }
  if (FAILED(hr)) {
    TPLOG("d3d: probe device failed hr=0x%08lx", hr);
    DestroyWindow(hwnd);
    UnregisterClassW(wc.lpszClassName, wc.hInstance);
    return false;
  }

  void** swapVt = *reinterpret_cast<void***>(sc);
  void** devVt = *reinterpret_cast<void***>(dev);
  bool ok = PatchVtable(swapVt, 8, reinterpret_cast<void*>(&HkPresent), g_present);
  ok = PatchVtable(swapVt, 13, reinterpret_cast<void*>(&HkResizeBuffers), g_resize) && ok;
  IDXGISwapChain1* sc1 = nullptr;
  if (SUCCEEDED(sc->QueryInterface(IID_PPV_ARGS(&sc1)))) {
    PatchVtable(*reinterpret_cast<void***>(sc1), 22, reinterpret_cast<void*>(&HkPresent1), g_present1);
    sc1->Release();
  }
  ok = PatchVtable(devVt, 5, reinterpret_cast<void*>(&HkCreateTexture2D), g_createTex) && ok;
  // Seeing which view the driver has (the windshield HUD) is a nicety: no failure if it cannot.
  // (The context's binds are watched from the first frame, on the game's own context.)
  PatchVtable(devVt, 7, reinterpret_cast<void*>(&HkCreateShaderResourceView), g_createSrv);

  ctx->Release();
  dev->Release();
  sc->Release();
  DestroyWindow(hwnd);
  UnregisterClassW(wc.lpszClassName, wc.hInstance);
  TPLOG("d3d: hooks %s (Present %p, CreateTexture2D %p, CreateShaderResourceView %p)", ok ? "installed" : "FAILED",
        g_present.original, g_createTex.original, g_createSrv.original);
  return ok;
}

void Uninstall() {
  UnpatchVtable(g_omSetRtUav);
  UnpatchVtable(g_omSetRt);
  UnpatchVtable(g_psSetSrv);
  UnpatchVtable(g_createSrv);
  UnpatchVtable(g_createTex);
  UnpatchVtable(g_present1);
  UnpatchVtable(g_present);
  UnpatchVtable(g_resize);
  Sleep(50);  // let an in-flight Present leave our code
  overlay::Shutdown();
  ReleaseFrameTexture();
  ReleaseLayer(g_hud);
  ReleaseLayer(g_wind);
  SafeRelease(g_cabTarget);
  g_watch = {};
  {
    std::lock_guard lock(g_markersMu);
    for (const Marker& m : g_markers) m.tex->Release();
    g_markers.clear();
    for (const AdvisorMarker& a : g_advisors) {
      a.rtv->Release();
      a.tex->Release();
    }
    g_advisors.clear();
  }
  if (g_ctx) g_ctx->Release();
  if (g_device) g_device->Release();
  g_ctx = nullptr;
  g_device = nullptr;
  g_swap = nullptr;
}

std::string ScreenJson() {
  std::lock_guard lock(g_markersMu);
  return ScreenJsonLocked();
}

std::string ViewJson() { return ViewJsonOf(g_viewW, g_viewH); }

void SetHudBottom(bool bottom) { g_hudBottom = bottom; }

void SetWind(bool on, float dropDegrees) {
  g_windOn = on;
  g_windDrop = dropDegrees;
}

void SetAdvisor(bool on) {
  if (g_advisorOn.exchange(on) != on) g_advisorStale = true;
}

}  // namespace tp::d3d
