// TruckPlay test cab: a small stand-in for ETS2. It loads truckplay.dll the way the game does (the
// D3D11 device exists first), creates the in-cab screen's marker texture like the game's GPS script
// (1282×1282, DEFAULT, sRGB, no initial data), draws it as a screen in a cab-like view and reads
// the mouse through raw input, so plugin, host and UI can be tried end to end without the game.
// It uses its own pipe and shared-memory names, so it runs fine next to a live game.
//
//   testcab.exe                        hold G to touch the screen, Y brings it closer, F10 saves a
//                                      screenshot, Esc quits; the mouse looks around otherwise
//   testcab.exe --script steps.txt     scripted run; screenshots go to --shots <dir>
//   --no-host                          do not start the TruckPlay host (start it yourself)
//   --window WxH                       the game's window (1600x900; 2560x1440 as a 1440p game)
//
// Script steps, one per line (# comments):
//   wait <ms>             ptr <x> <y>          glide <x> <y> <ms>      down | up | click
//   wheel <delta>         release              big on|off              js <code>
//   shot <name>           screen <name>        quit
//   gps on|off|still      the GPS screen drawn, not drawn, or drawn without the map being drawn
//                         anew (as the game does with an outside camera)
// x, y are 0–1 across the UI. "shot" saves the window, "screen" the UI as the plugin composed it.

#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>
#include <wincodec.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <deque>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

UINT kWinW = 1600, kWinH = 900;
// The marker the cab's GPS script creates. --marker WxH picks one of the mod's per-screen markers
// (shared/screens.json), whose glass shows all of it; the default square one is the generic
// script's, whose glass shows a band (host/src/screens.js places the UI there).
UINT g_markerW = 1282, g_markerH = 1282;
UINT g_bandTop = 0, g_bandH = 0;
// --advisor: the route advisor's TruckPlay panel marker too (as the mod's adviser_gps.sii makes
// the game create it); the "advisor" step saves what the plugin drew into it.
bool g_withAdvisor = false;
ID3D11Texture2D* g_advisor = nullptr;
ID3D11ShaderResourceView* g_advisorSrv = nullptr;

constexpr char kShader[] = R"(
cbuffer Scene : register(b0) {
  float4 cam;   // yaw, pitch, aspect, glass aspect
  float4 band;  // v top, v bottom, bezel, unused
};
Texture2D screenTex : register(t0);
SamplerState smp : register(s0);

struct V { float4 pos : SV_Position; float2 local : TEXCOORD0; };

V VS(uint id : SV_VertexID) {
  const float2 corner[6] = { float2(0, 0), float2(1, 0), float2(0, 1), float2(0, 1), float2(1, 0), float2(1, 1) };
  float2 q = corner[id];
  float2 b = q * (1 + 2 * band.z) - band.z;  // -bezel … 1 + bezel
  float w = 0.40, h = w / cam.w;
  float3 p = float3((b.x - 0.5) * w, (0.5 - b.y) * h, 0);
  // The screen sits right of centre on the dash, turned toward the driver.
  float a = -0.42, ca = cos(a), sa = sin(a);
  p = float3(p.x * ca + p.z * sa, p.y, -p.x * sa + p.z * ca);
  p += float3(0.15, -0.055, 0.5);
  float cy = cos(cam.x), sy = sin(cam.x), cp = cos(cam.y), sp = sin(cam.y);
  float3 v = float3(p.x * cy - p.z * sy, p.y, p.x * sy + p.z * cy);
  v = float3(v.x, v.y * cp - v.z * sp, v.y * sp + v.z * cp);
  float f = 1 / tan(radians(58) * 0.5);
  float zn = 0.05, zf = 10;
  V o;
  o.pos = float4(v.x * f / cam.z, v.y * f, v.z * zf / (zf - zn) - zn * zf / (zf - zn), v.z);
  o.local = b;
  return o;
}

float4 PS(V i) : SV_Target {
  float2 b = i.local;
  float2 d = abs(b - 0.5) - 0.5;
  float inside = step(max(d.x, d.y), 0);
  float2 uv = float2(b.x, lerp(band.x, band.y, b.y));
  float3 screen = screenTex.Sample(smp, saturate(uv)).rgb;
  // Glossy black bezel with a hint of reflection toward the top.
  float3 bezel = lerp(float3(0.004, 0.004, 0.005), float3(0.03, 0.032, 0.036), saturate(-b.y * 4 + 0.2));
  return float4(lerp(bezel, screen, inside), 1);
}
)";

struct SceneCb {
  float cam[4];
  float band[4];
};

// The game's GPS chain, as the cab test needs it: the game renders its navigation map into a
// texture of its own (the "bare map"); the GPS script draws that map into the cab screen's render
// target and TruckPlay's marker over it; the cab's screen then shows the render target. Here the map
// is a made-up one in the game's own colours (def/map_data.sii): clear where there is nothing, the
// roads it has seen in yellow, junctions beige, buildings orange, grass green, a grid of them turning
// and sliding as if driven through; the route ahead in red with a black edge and a green arrow where
// it turns, and the truck's arrow in the middle. --baremap <file> shows a map dumped from the game
// instead (the plugin's dump-map, a still picture).
constexpr char kGpsShader[] = R"(
cbuffer Gps : register(b0) {
  float4 t;     // x: seconds
  float4 crop;  // the part of the source drawn: u0, v0, u1, v1
};
Texture2D src : register(t0);
SamplerState smp : register(s0);

struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };

V VS(uint id : SV_VertexID) {
  float2 uv = float2((id << 1) & 2, id & 2);
  V o;
  o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
  o.uv = uv;
  return o;
}

// Lays `c` (straight colour, coverage k) over `acc` (premultiplied).
float4 Over(float4 acc, float3 c, float k) { return float4(c * k, k) + acc * (1 - k); }

float4 PSMap(V i) : SV_Target {
  // The game's GPS map turns with the truck: its road runs straight up the picture. The game keeps
  // it upside down in the texture (its GPS script draws it with top=0.75 bottom=0.25).
  float2 p = (float2(i.uv.x, 1.0 - i.uv.y) - 0.5) * 2;
  float2 truck = float2(0, -t.x * 0.08);
  float2 w = p + truck;
  const float aa = 0.0022;
  float4 acc = float4(0, 0, 0, 0);
  // Blocks: some grass, some a building, the rest nothing.
  float2 cell = floor(w * 3), f = frac(w * 3);
  float h = frac(sin(dot(cell, float2(12.9898, 78.233))) * 43758.5453);
  float inner = step(0.14, f.x) * step(f.x, 0.86) * step(0.14, f.y) * step(f.y, 0.86);
  float core = step(0.32, f.x) * step(f.x, 0.68) * step(0.32, f.y) * step(f.y, 0.62);
  if (h < 0.3) acc = Over(acc, float3(0.663, 0.792, 0.584), inner);
  else if (h < 0.55) acc = Over(acc, float3(0.878, 0.635, 0.231), core);
  // Roads every third of a unit, in the yellow of roads the game has seen; junctions beige.
  float2 g = abs(frac(w * 3 + 0.5) - 0.5) / 3;
  float onRoad = 1 - smoothstep(0.007 - aa, 0.007 + aa, min(g.x, g.y));
  acc = Over(acc, float3(1.0, 0.776, 0.298), onRoad);
  float junction = 1 - smoothstep(0.014 - aa, 0.014 + aa, max(g.x, g.y));
  acc = Over(acc, float3(0.922, 0.792, 0.596), junction);
  // The route: ahead along x = 0 to the second junction, then right.
  float turnY = (floor(truck.y * 3) - 1) / 3;
  float d1 = max(abs(w.x), max(w.y - truck.y, turnY - w.y));
  float d2 = max(abs(w.y - turnY), max(-w.x, w.x - 0.9));
  float d = min(max(d1, 0), max(d2, 0));
  float edge = 1 - smoothstep(0.0125 - aa, 0.0125 + aa, d);
  float fill = 1 - smoothstep(0.0095 - aa, 0.0095 + aa, d);
  acc = Over(acc, float3(0, 0, 0), edge);
  acc = Over(acc, float3(0.875, 0.259, 0.047), fill);
  // The game's arrow where the route turns.
  float2 j = w - float2(0.045, turnY);
  float arrow = step(abs(j.y) * 1.4 + j.x, 0.012) * step(-0.012, j.x);
  acc = Over(acc, float3(0.067, 0.984, 0.024), arrow);
  // The truck.
  float2 q = p * 14;
  float body = step(abs(q.x) * 1.6 - q.y, 1.0) * step(q.y, 1.0) * step(abs(q.x), 0.9);
  float rim = step(abs(q.x) * 1.6 - q.y, 1.35) * step(q.y, 1.25) * step(abs(q.x), 1.15);
  // In the game's two blues (a 3D arrow's two faces, 1.62): #0d82d0 and #12aeff.
  acc = Over(acc, float3(0.051, 0.510, 0.816), rim);
  acc = Over(acc, float3(0.071, 0.682, 1.0), body);
  float3 rgb = acc.a > 0 ? acc.rgb / acc.a : float3(0, 0, 0);
  return float4(pow(rgb, 2.2), acc.a);  // straight colour into the sRGB target
}

float4 PSBlit(V i) : SV_Target {
  return src.Sample(smp, lerp(crop.xy, crop.zw, i.uv));
}
)";

struct GpsCb {
  float t[4];
  float crop[4];
};

HWND g_hwnd = nullptr;
ID3D11Device* g_dev = nullptr;
ID3D11DeviceContext* g_ctx = nullptr;
IDXGISwapChain1* g_sc = nullptr;
ID3D11RenderTargetView* g_rtv = nullptr;
ID3D11Texture2D* g_marker = nullptr;
ID3D11ShaderResourceView* g_markerSrv = nullptr;
// The game's side of the cab screen: its map texture and the screen's render target.
ID3D11Texture2D* g_bareMap = nullptr;
ID3D11RenderTargetView* g_bareRtv = nullptr;
ID3D11ShaderResourceView* g_bareSrv = nullptr;
UINT g_bareW = 1024, g_bareH = 1024;
std::wstring g_bareFile;  // --baremap: a map dumped from the game, shown still
bool g_bareStill = false;
// The "gps off" step: the game stops drawing its GPS screen, as it does with an outside camera.
bool g_gpsOn = true;
bool g_mapStill = false;  // "gps still": the GPS screen drawn, its map no longer drawn anew
ID3D11Texture2D* g_gps = nullptr;
ID3D11RenderTargetView* g_gpsRtv = nullptr;
ID3D11ShaderResourceView* g_gpsSrv = nullptr;
ID3D11VertexShader* g_gpsVs = nullptr;
ID3D11PixelShader* g_mapPs = nullptr;
ID3D11PixelShader* g_blitPs = nullptr;
ID3D11Buffer* g_gpsCb = nullptr;
ULONGLONG g_gpsStart = 0;
ID3D11VertexShader* g_vs = nullptr;
ID3D11PixelShader* g_ps = nullptr;
ID3D11Buffer* g_cb = nullptr;
ID3D11SamplerState* g_smp = nullptr;
ID3D11RasterizerState* g_rs = nullptr;
float g_yaw = 0.27f, g_pitch = -0.1f;  // looking at the screen, a little down and to the right
bool g_shotRequested = false;
bool g_quit = false;
bool g_focused = false;
bool g_scripted = false;  // scripted runs keep the camera still, whatever the real mouse does
std::wstring g_shots;

// Plugin test hooks.
int (*g_start)() = nullptr;
void (*g_stop)() = nullptr;
void (*g_big)(int) = nullptr;
void (*g_pointer)(int, float, float, int) = nullptr;
void (*g_wheel)(int) = nullptr;
void (*g_send)(const char*) = nullptr;

std::wstring Widen(const std::string& s) {
  std::wstring w(MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, w.data(), static_cast<int>(w.size()));
  if (!w.empty() && w.back() == L'\0') w.pop_back();
  return w;
}

std::string Narrow(const std::wstring& w) {
  std::string s(WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, s.data(), static_cast<int>(s.size()), nullptr, nullptr);
  if (!s.empty() && s.back() == '\0') s.pop_back();
  return s;
}

std::wstring ExeDir() {
  wchar_t buf[MAX_PATH];
  const DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
  std::wstring p(buf, n);
  return p.substr(0, p.find_last_of(L"\\/"));
}

// ---------------- screenshots (WIC PNG) ----------------

bool SavePng(const std::wstring& file, const uint8_t* bgra, UINT w, UINT h, UINT pitch) {
  IWICImagingFactory* f = nullptr;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&f)))) return false;
  IWICStream* stream = nullptr;
  IWICBitmapEncoder* enc = nullptr;
  IWICBitmapFrameEncode* frame = nullptr;
  bool ok = SUCCEEDED(f->CreateStream(&stream)) && SUCCEEDED(stream->InitializeFromFilename(file.c_str(), GENERIC_WRITE)) &&
            SUCCEEDED(f->CreateEncoder(GUID_ContainerFormatPng, nullptr, &enc)) &&
            SUCCEEDED(enc->Initialize(stream, WICBitmapEncoderNoCache)) && SUCCEEDED(enc->CreateNewFrame(&frame, nullptr)) &&
            SUCCEEDED(frame->Initialize(nullptr)) && SUCCEEDED(frame->SetSize(w, h));
  if (ok) {
    // PNG takes 24-bit BGR as is; repack (the encoder would otherwise pick its own format).
    std::vector<BYTE> rgb(static_cast<size_t>(w) * 3 * h);
    for (UINT y = 0; y < h; ++y) {
      const uint8_t* src = bgra + static_cast<size_t>(y) * pitch;
      BYTE* dst = rgb.data() + static_cast<size_t>(y) * w * 3;
      for (UINT x = 0; x < w; ++x) {
        dst[x * 3 + 0] = src[x * 4 + 0];
        dst[x * 3 + 1] = src[x * 4 + 1];
        dst[x * 3 + 2] = src[x * 4 + 2];
      }
    }
    WICPixelFormatGUID fmt = GUID_WICPixelFormat24bppBGR;
    ok = SUCCEEDED(frame->SetPixelFormat(&fmt)) && IsEqualGUID(fmt, GUID_WICPixelFormat24bppBGR) &&
         SUCCEEDED(frame->WritePixels(h, w * 3, static_cast<UINT>(rgb.size()), rgb.data())) && SUCCEEDED(frame->Commit()) &&
         SUCCEEDED(enc->Commit());
  }
  if (frame) frame->Release();
  if (enc) enc->Release();
  if (stream) stream->Release();
  f->Release();
  return ok;
}

bool SaveTexture(ID3D11Texture2D* tex, const D3D11_BOX* box, const std::wstring& file) {
  D3D11_TEXTURE2D_DESC d;
  tex->GetDesc(&d);
  const UINT w = box ? box->right - box->left : d.Width, h = box ? box->bottom - box->top : d.Height;
  D3D11_TEXTURE2D_DESC s{};
  s.Width = w;
  s.Height = h;
  s.MipLevels = 1;
  s.ArraySize = 1;
  s.Format = d.Format;
  s.SampleDesc.Count = 1;
  s.Usage = D3D11_USAGE_STAGING;
  s.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  ID3D11Texture2D* staging = nullptr;
  if (FAILED(g_dev->CreateTexture2D(&s, nullptr, &staging))) return false;
  g_ctx->CopySubresourceRegion(staging, 0, 0, 0, 0, tex, 0, box);
  D3D11_MAPPED_SUBRESOURCE m;
  bool ok = false;
  if (SUCCEEDED(g_ctx->Map(staging, 0, D3D11_MAP_READ, 0, &m))) {
    ok = SavePng(file, static_cast<const uint8_t*>(m.pData), w, h, m.RowPitch);
    g_ctx->Unmap(staging, 0);
  }
  staging->Release();
  return ok;
}

std::wstring ShotPath(const std::string& name) {
  CreateDirectoryW(g_shots.c_str(), nullptr);
  return g_shots + L"\\" + Widen(name) + L".png";
}

// ---------------- the window ----------------

void ClipToWindow(bool on) {
  if (!on) {
    ClipCursor(nullptr);
    return;
  }
  RECT r;
  GetClientRect(g_hwnd, &r);
  MapWindowPoints(g_hwnd, nullptr, reinterpret_cast<POINT*>(&r), 2);
  ClipCursor(&r);
}

LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
    case WM_INPUT: {
      RAWINPUT ri;
      UINT size = sizeof ri;
      if (GetRawInputData(reinterpret_cast<HRAWINPUT>(l), RID_INPUT, &ri, &size, sizeof(RAWINPUTHEADER)) != static_cast<UINT>(-1) &&
          ri.header.dwType == RIM_TYPEMOUSE && g_focused && !g_scripted && !(ri.data.mouse.usFlags & MOUSE_MOVE_ABSOLUTE)) {
        // Mouse look, like the game's interior camera. While G is held the plugin keeps these.
        g_yaw = std::clamp(g_yaw + ri.data.mouse.lLastX * 0.0022f, -1.2f, 1.2f);
        g_pitch = std::clamp(g_pitch + ri.data.mouse.lLastY * 0.0022f, -0.7f, 0.7f);
      }
      return DefWindowProcW(h, m, w, l);
    }
    case WM_KEYDOWN:
      if (w == VK_F10) g_shotRequested = true;
      if (w == VK_ESCAPE) g_quit = true;
      return 0;
    case WM_ACTIVATE:
      g_focused = LOWORD(w) != WA_INACTIVE;
      if (!g_scripted) {
        ShowCursor(g_focused ? FALSE : TRUE);
        ClipToWindow(g_focused);
      }
      return 0;
    case WM_CLOSE:
      g_quit = true;
      return 0;
    default:
      return DefWindowProcW(h, m, w, l);
  }
}

bool CreateWindowAndDevice() {
  WNDCLASSEXW wc{sizeof wc};
  wc.lpfnWndProc = WndProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.lpszClassName = L"TruckPlayTestCab";
  RegisterClassExW(&wc);
  RECT r{0, 0, static_cast<LONG>(kWinW), static_cast<LONG>(kWinH)};
  AdjustWindowRect(&r, WS_OVERLAPPEDWINDOW & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX, FALSE);
  g_hwnd = CreateWindowExW(0, wc.lpszClassName, L"TruckPlay test kabini", WS_OVERLAPPEDWINDOW & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX,
                           CW_USEDEFAULT, CW_USEDEFAULT, r.right - r.left, r.bottom - r.top, nullptr, nullptr, wc.hInstance, nullptr);
  if (!g_hwnd) return false;

  if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0,
                               D3D11_SDK_VERSION, &g_dev, nullptr, &g_ctx))) {
    return false;
  }
  IDXGIDevice* dxgiDev = nullptr;
  IDXGIAdapter* adapter = nullptr;
  IDXGIFactory2* factory = nullptr;
  g_dev->QueryInterface(IID_PPV_ARGS(&dxgiDev));
  dxgiDev->GetAdapter(&adapter);
  adapter->GetParent(IID_PPV_ARGS(&factory));
  // BGRA flip model like the game, but sequential with two buffers: a presented frame comes back as
  // the back buffer two frames later, untouched, so shots can include what the plugin drew in
  // Present (the HUD, the big view).
  DXGI_SWAP_CHAIN_DESC1 sd{};
  sd.Width = kWinW;
  sd.Height = kWinH;
  sd.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  sd.SampleDesc.Count = 1;
  sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  sd.BufferCount = 2;
  sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
  const HRESULT hr = factory->CreateSwapChainForHwnd(g_dev, g_hwnd, &sd, nullptr, nullptr, &g_sc);
  factory->Release();
  adapter->Release();
  dxgiDev->Release();
  if (FAILED(hr)) return false;

  ID3D11Texture2D* back = nullptr;
  g_sc->GetBuffer(0, IID_PPV_ARGS(&back));
  D3D11_RENDER_TARGET_VIEW_DESC rv{};
  rv.Format = DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;  // the scene is lit in linear light
  rv.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2D;
  g_dev->CreateRenderTargetView(back, &rv, &g_rtv);
  back->Release();

  ID3DBlob* vs = nullptr;
  ID3DBlob* ps = nullptr;
  ID3DBlob* err = nullptr;
  if (FAILED(D3DCompile(kShader, sizeof kShader - 1, "testcab", nullptr, nullptr, "VS", "vs_5_0", 0, 0, &vs, &err)) ||
      FAILED(D3DCompile(kShader, sizeof kShader - 1, "testcab", nullptr, nullptr, "PS", "ps_5_0", 0, 0, &ps, &err))) {
    printf("shader: %s\n", err ? static_cast<const char*>(err->GetBufferPointer()) : "?");
    return false;
  }
  g_dev->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &g_vs);
  g_dev->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, &g_ps);
  vs->Release();
  ps->Release();

  if (SUCCEEDED(D3DCompile(kGpsShader, sizeof kGpsShader - 1, "testcab_gps", nullptr, nullptr, "VS", "vs_5_0", 0, 0, &vs, &err))) {
    g_dev->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &g_gpsVs);
    vs->Release();
  }
  for (const auto& [entry, out] : {std::pair{"PSMap", &g_mapPs}, std::pair{"PSBlit", &g_blitPs}}) {
    if (SUCCEEDED(D3DCompile(kGpsShader, sizeof kGpsShader - 1, "testcab_gps", nullptr, nullptr, entry, "ps_5_0", 0, 0, &ps, &err))) {
      g_dev->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, out);
      ps->Release();
    } else {
      printf("gps shader: %s\n", err ? static_cast<const char*>(err->GetBufferPointer()) : "?");
    }
  }

  D3D11_BUFFER_DESC cb{};
  cb.ByteWidth = sizeof(GpsCb);
  cb.Usage = D3D11_USAGE_DYNAMIC;
  cb.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
  cb.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
  g_dev->CreateBuffer(&cb, nullptr, &g_gpsCb);
  cb.ByteWidth = sizeof(SceneCb);
  cb.Usage = D3D11_USAGE_DYNAMIC;
  cb.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
  cb.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
  g_dev->CreateBuffer(&cb, nullptr, &g_cb);
  D3D11_SAMPLER_DESC smp{};
  smp.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  smp.AddressU = smp.AddressV = smp.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  smp.MaxLOD = D3D11_FLOAT32_MAX;
  g_dev->CreateSamplerState(&smp, &g_smp);
  D3D11_RASTERIZER_DESC rs{};
  rs.FillMode = D3D11_FILL_SOLID;
  rs.CullMode = D3D11_CULL_NONE;
  rs.DepthClipEnable = TRUE;
  g_dev->CreateRasterizerState(&rs, &g_rs);

  RAWINPUTDEVICE dev[2] = {{1, 2, 0, g_hwnd}, {1, 6, 0, g_hwnd}};
  RegisterRawInputDevices(dev, 2, sizeof(RAWINPUTDEVICE));
  return true;
}

// Getting into the truck: the GPS script creates the screen's marker texture.
void CreateMarker() {
  D3D11_TEXTURE2D_DESC d{};
  d.Width = g_markerW;
  d.Height = g_markerH;
  d.MipLevels = 1;
  d.ArraySize = 1;
  d.Format = DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;
  d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT;
  d.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &g_marker))) {
    printf("marker texture failed\n");
    return;
  }
  g_dev->CreateShaderResourceView(g_marker, nullptr, &g_markerSrv);
  printf("marker texture %ux%u created\n", g_markerW, g_markerH);
  // The game's map texture and the cab screen's render target (the marker's size).
  D3D11_TEXTURE2D_DESC t = d;
  t.Width = t.Height = 1024;
  t.Format = DXGI_FORMAT_R8G8B8A8_UNORM_SRGB;
  t.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  std::vector<uint8_t> dumped;
  D3D11_SUBRESOURCE_DATA dumpedInit{};
  if (!g_bareFile.empty()) {
    // The plugin's dump: a 128-byte text header "TPMAP w h format bpp linear", then the rows.
    if (FILE* f = _wfopen(g_bareFile.c_str(), L"rb")) {
      char head[128] = {};
      unsigned w = 0, h = 0, bpp = 0;
      int fmt = 0, linear = 0;
      if (fread(head, 1, sizeof head, f) == sizeof head && sscanf_s(head, "TPMAP %u %u %d %u %d", &w, &h, &fmt, &bpp, &linear) == 5 &&
          w && h && bpp) {
        dumped.resize(static_cast<size_t>(w) * h * bpp);
        if (fread(dumped.data(), 1, dumped.size(), f) == dumped.size()) {
          t.Width = w;
          t.Height = h;
          t.Format = static_cast<DXGI_FORMAT>(fmt);
          dumpedInit = {dumped.data(), w * bpp, 0};
          g_bareStill = true;
          printf("bare map %ux%u fmt=%d from the dump\n", w, h, fmt);
        }
      }
      fclose(f);
    }
    if (!g_bareStill) printf("bare map dump unreadable, drawing a made-up map\n");
  }
  if (SUCCEEDED(g_dev->CreateTexture2D(&t, g_bareStill ? &dumpedInit : nullptr, &g_bareMap))) {
    g_dev->CreateRenderTargetView(g_bareMap, nullptr, &g_bareRtv);
    g_dev->CreateShaderResourceView(g_bareMap, nullptr, &g_bareSrv);
    g_bareW = t.Width;
    g_bareH = t.Height;
  }
  t = d;
  t.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  if (SUCCEEDED(g_dev->CreateTexture2D(&t, nullptr, &g_gps))) {
    g_dev->CreateRenderTargetView(g_gps, nullptr, &g_gpsRtv);
    g_dev->CreateShaderResourceView(g_gps, nullptr, &g_gpsSrv);
  }
  g_gpsStart = GetTickCount64();
  if (!g_withAdvisor) return;
  d.Width = 642;
  d.Height = 559;
  std::vector<uint8_t> clear(static_cast<size_t>(d.Width) * d.Height * 4, 0);
  const D3D11_SUBRESOURCE_DATA init{clear.data(), d.Width * 4, 0};
  if (SUCCEEDED(g_dev->CreateTexture2D(&d, &init, &g_advisor))) {
    g_dev->CreateShaderResourceView(g_advisor, nullptr, &g_advisorSrv);
    printf("advisor texture %ux%u created\n", d.Width, d.Height);
  }
}

// The game's GPS screen this frame: its map, then the GPS script's images into the screen's target.
void RenderGps() {
  if (!g_gpsOn || !g_bareRtv || !g_gpsRtv || !g_gpsVs || !g_mapPs || !g_blitPs) return;
  const auto draw = [](ID3D11RenderTargetView* rtv, UINT w, UINT h, ID3D11PixelShader* ps, ID3D11ShaderResourceView* src,
                       const float crop[4]) {
    D3D11_MAPPED_SUBRESOURCE m;
    if (SUCCEEDED(g_ctx->Map(g_gpsCb, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
      const GpsCb c{{(GetTickCount64() - g_gpsStart) / 1000.0f, 0, 0, 0}, {crop[0], crop[1], crop[2], crop[3]}};
      memcpy(m.pData, &c, sizeof c);
      g_ctx->Unmap(g_gpsCb, 0);
    }
    const D3D11_VIEWPORT vp{0, 0, static_cast<float>(w), static_cast<float>(h), 0, 1};
    g_ctx->OMSetRenderTargets(1, &rtv, nullptr);
    g_ctx->RSSetViewports(1, &vp);
    g_ctx->RSSetState(g_rs);
    g_ctx->OMSetBlendState(nullptr, nullptr, 0xffffffff);
    g_ctx->IASetInputLayout(nullptr);
    g_ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    g_ctx->VSSetShader(g_gpsVs, nullptr, 0);
    g_ctx->PSSetShader(ps, nullptr, 0);
    g_ctx->PSSetConstantBuffers(0, 1, &g_gpsCb);
    g_ctx->PSSetShaderResources(0, 1, &src);
    g_ctx->PSSetSamplers(0, 1, &g_smp);
    g_ctx->Draw(3, 0);
  };
  const float whole[4] = {0, 0, 1, 1};
  const float centre[4] = {0.25f, 0.75f, 0.75f, 0.25f};  // as the game's GPS script crops (and turns) its map
  ID3D11ShaderResourceView* none = nullptr;
  if (!g_mapStill) {
    if (!g_bareStill) draw(g_bareRtv, g_bareW, g_bareH, g_mapPs, none, whole);
    else g_ctx->OMSetRenderTargets(1, &g_bareRtv, nullptr);  // a dumped map: drawn anew, unchanged
  }
  const float black[4] = {0, 0, 0, 1};
  g_ctx->ClearRenderTargetView(g_gpsRtv, black);
  draw(g_gpsRtv, g_markerW, g_markerH, g_blitPs, g_bareSrv, centre);
  draw(g_gpsRtv, g_markerW, g_markerH, g_blitPs, g_markerSrv, whole);
  g_ctx->PSSetShaderResources(0, 1, &none);
}

void Render() {
  const float clear[4] = {0.012f, 0.014f, 0.02f, 1.0f};
  RenderGps();
  g_ctx->ClearRenderTargetView(g_rtv, clear);
  if (g_markerSrv) {
    D3D11_MAPPED_SUBRESOURCE m;
    if (SUCCEEDED(g_ctx->Map(g_cb, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
      const SceneCb s{{g_yaw, g_pitch, static_cast<float>(kWinW) / kWinH, static_cast<float>(g_markerW) / g_bandH},
                      {static_cast<float>(g_bandTop) / g_markerH, static_cast<float>(g_bandTop + g_bandH) / g_markerH, 0.035f, 0}};
      memcpy(m.pData, &s, sizeof s);
      g_ctx->Unmap(g_cb, 0);
    }
    const D3D11_VIEWPORT vp{0, 0, static_cast<float>(kWinW), static_cast<float>(kWinH), 0, 1};
    g_ctx->OMSetRenderTargets(1, &g_rtv, nullptr);
    g_ctx->RSSetViewports(1, &vp);
    g_ctx->RSSetState(g_rs);
    g_ctx->OMSetBlendState(nullptr, nullptr, 0xffffffff);
    g_ctx->IASetInputLayout(nullptr);
    g_ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    g_ctx->VSSetShader(g_vs, nullptr, 0);
    g_ctx->VSSetConstantBuffers(0, 1, &g_cb);
    g_ctx->PSSetShader(g_ps, nullptr, 0);
    g_ctx->PSSetConstantBuffers(0, 1, &g_cb);
    // The cab's screen shows the GPS screen's render target (the marker over the game's map).
    ID3D11ShaderResourceView* screen = g_gpsSrv ? g_gpsSrv : g_markerSrv;
    g_ctx->PSSetShaderResources(0, 1, &screen);
    g_ctx->PSSetSamplers(0, 1, &g_smp);
    g_ctx->Draw(6, 0);
    ID3D11ShaderResourceView* none = nullptr;
    g_ctx->PSSetShaderResources(0, 1, &none);
  }
}

// ---------------- the host ----------------

HANDLE g_job = nullptr;

void StartHost(const std::wstring& root, bool demo) {
  const std::wstring electron = root + L"\\host\\node_modules\\electron\\dist\\electron.exe";
  std::wstring cmd = L"\"" + electron + L"\" \"" + root + L"\\host\" --profile cab" + (demo ? L" --demo" : L"");
  g_job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION lim{};
  lim.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  SetInformationJobObject(g_job, JobObjectExtendedLimitInformation, &lim, sizeof lim);
  STARTUPINFOW si{sizeof si};
  PROCESS_INFORMATION pi{};
  if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr,
                     (root + L"\\host").c_str(), &si, &pi)) {
    AssignProcessToJobObject(g_job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    printf("host started (pid %lu)\n", pi.dwProcessId);
  } else {
    printf("host start failed (%lu)\n", GetLastError());
  }
}

// ---------------- scripts ----------------

struct Step {
  std::string op;
  std::vector<std::string> args;
  std::string rest;
};

std::deque<Step> g_steps;
ULONGLONG g_stepUntil = 0;
bool g_stepActive = false;
float g_ptrX = 0.5f, g_ptrY = 0.5f;
bool g_ptrOn = false, g_ptrDown = false;
float g_glideFromX = 0, g_glideFromY = 0, g_glideToX = 0, g_glideToY = 0;
ULONGLONG g_glideStart = 0, g_glideMs = 0;

void LoadScript(const std::wstring& file) {
  std::ifstream in(file);
  std::string line;
  while (std::getline(in, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    Step s;
    std::istringstream ss(line);
    ss >> s.op;
    const size_t restAt = line.find_first_not_of(' ', s.op.size());
    s.rest = restAt == std::string::npos ? "" : line.substr(restAt);
    std::string a;
    while (ss >> a) s.args.push_back(a);
    g_steps.push_back(s);
  }
  printf("script: %zu steps\n", g_steps.size());
}

float Arg(const Step& s, size_t i, float fallback = 0) { return i < s.args.size() ? static_cast<float>(atof(s.args[i].c_str())) : fallback; }

void Pointer() { g_pointer(g_ptrOn ? 1 : 0, g_ptrX, g_ptrY, g_ptrDown ? 1 : 0); }

std::string JsonQuote(const std::string& s) {
  std::string out = "\"";
  for (const char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  return out + "\"";
}

// Runs due steps; screenshots are taken after rendering (see the main loop).
void RunScript(std::vector<std::string>* shotsOut, std::vector<std::string>* screensOut) {
  const ULONGLONG now = GetTickCount64();
  if (g_glideMs) {
    const float t = std::min(1.0f, static_cast<float>(now - g_glideStart) / static_cast<float>(g_glideMs));
    const float e = t < 0.5f ? 2 * t * t : 1 - std::pow(-2 * t + 2, 2.0f) / 2;  // ease in-out
    g_ptrX = g_glideFromX + (g_glideToX - g_glideFromX) * e;
    g_ptrY = g_glideFromY + (g_glideToY - g_glideFromY) * e;
    Pointer();
    if (t >= 1) g_glideMs = 0;
  }
  if (g_stepActive && now < g_stepUntil) return;
  g_stepActive = false;
  while (!g_steps.empty() && !g_stepActive) {
    const Step s = g_steps.front();
    g_steps.pop_front();
    printf("> %s %s\n", s.op.c_str(), s.rest.c_str());
    if (s.op == "wait") {
      g_stepUntil = now + static_cast<ULONGLONG>(Arg(s, 0, 500));
      g_stepActive = true;
    } else if (s.op == "ptr") {
      g_ptrOn = true;
      g_ptrX = Arg(s, 0, 0.5f);
      g_ptrY = Arg(s, 1, 0.5f);
      Pointer();
    } else if (s.op == "glide") {
      g_ptrOn = true;
      g_glideFromX = g_ptrX;
      g_glideFromY = g_ptrY;
      g_glideToX = Arg(s, 0, 0.5f);
      g_glideToY = Arg(s, 1, 0.5f);
      g_glideStart = now;
      g_glideMs = static_cast<ULONGLONG>(std::max(16.0f, Arg(s, 2, 400)));
      g_stepUntil = now + g_glideMs;
      g_stepActive = true;
    } else if (s.op == "down" || s.op == "up") {
      g_ptrOn = true;
      g_ptrDown = s.op == "down";
      Pointer();
    } else if (s.op == "click") {
      g_ptrOn = true;
      g_ptrDown = true;
      Pointer();
      g_steps.push_front({"up", {}, ""});
      g_steps.push_front({"wait", {"90"}, "90"});
    } else if (s.op == "wheel") {
      g_wheel(static_cast<int>(Arg(s, 0, -120)));
    } else if (s.op == "release") {
      g_ptrOn = false;
      g_ptrDown = false;
      Pointer();
    } else if (s.op == "gps") {
      g_gpsOn = s.rest != "off";
      g_mapStill = s.rest == "still";
    } else if (s.op == "big") {
      g_big(s.rest == "on" ? 1 : 0);
    } else if (s.op == "js") {
      g_send(("{\"t\":\"eval\",\"js\":" + JsonQuote(s.rest) + "}").c_str());
    } else if (s.op == "type") {
      // Typing, as the plugin reports it while it holds the keyboard for a text field.
      for (const char c : s.rest) g_send(("{\"t\":\"key\",\"act\":\"char\",\"ch\":" + JsonQuote(std::string(1, c)) + "}").c_str());
    } else if (s.op == "send") {
      g_send(s.rest.c_str());  // a message as if from the plugin, e.g. {"t":"menu","open":true}
    } else if (s.op == "enter") {
      g_send("{\"t\":\"key\",\"act\":\"down\",\"vk\":13}");
    } else if (s.op == "shot") {
      shotsOut->push_back(s.rest);
    } else if (s.op == "screen") {
      screensOut->push_back(s.rest);
    } else if (s.op == "advisor") {
      screensOut->push_back("@" + s.rest);
    } else if (s.op == "quit") {
      g_quit = true;
    } else {
      printf("  unknown step '%s'\n", s.op.c_str());
    }
  }
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const std::wstring dir = ExeDir();
  const std::wstring root = dir + L"\\..\\..";
  std::wstring script;
  bool host = true, demo = true;
  g_shots = dir + L"\\shots";
  for (int i = 1; i < argc; ++i) {
    const std::wstring a = argv[i];
    if (a == L"--script" && i + 1 < argc) {
      script = argv[++i];
      g_scripted = true;
    }
    else if (a == L"--shots" && i + 1 < argc) g_shots = argv[++i];
    else if (a == L"--no-host") host = false;
    else if (a == L"--marker" && i + 1 < argc) swscanf_s(argv[++i], L"%ux%u", &g_markerW, &g_markerH);
    else if (a == L"--live") demo = false;
    else if (a == L"--advisor") g_withAdvisor = true;
    else if (a == L"--baremap" && i + 1 < argc) g_bareFile = argv[++i];
    else if (a == L"--window" && i + 1 < argc) swscanf_s(argv[++i], L"%ux%u", &kWinW, &kWinH);
  }

  if (g_markerW == g_markerH) {
    // The generic script's glass: as host/src/screens.js assumes for trucks it does not know.
    g_bandTop = static_cast<UINT>(g_markerH * 0.14 + 0.5);
    g_bandH = static_cast<UINT>(g_markerH * 0.6 + 0.5);
  } else {
    g_bandTop = 0;
    g_bandH = g_markerH;
  }

  // Own names: the cab, its plugin and its host never touch a running game's.
  SetEnvironmentVariableW(L"TRUCKPLAY_SHM", L"TruckPlayFramesCab");
  SetEnvironmentVariableW(L"TRUCKPLAY_PIPE", L"tirplay-cab");

  if (!CreateWindowAndDevice()) {
    printf("device creation failed\n");
    return 2;
  }
  ShowWindow(g_hwnd, SW_SHOW);

  HMODULE dll = LoadLibraryW((dir + L"\\truckplay.dll").c_str());
  if (!dll) {
    printf("truckplay.dll not found next to testcab.exe\n");
    return 3;
  }
  g_start = reinterpret_cast<int (*)()>(GetProcAddress(dll, "tirplay_selftest_start"));
  g_stop = reinterpret_cast<void (*)()>(GetProcAddress(dll, "tirplay_selftest_stop"));
  g_big = reinterpret_cast<void (*)(int)>(GetProcAddress(dll, "tirplay_selftest_big"));
  g_pointer = reinterpret_cast<void (*)(int, float, float, int)>(GetProcAddress(dll, "tirplay_selftest_pointer"));
  g_wheel = reinterpret_cast<void (*)(int)>(GetProcAddress(dll, "tirplay_selftest_wheel"));
  g_send = reinterpret_cast<void (*)(const char*)>(GetProcAddress(dll, "tirplay_selftest_send"));
  if (!g_start || !g_stop || !g_big || !g_pointer || !g_wheel || !g_send) {
    printf("truckplay.dll is missing the test hooks\n");
    return 4;
  }
  g_start();
  if (host) StartHost(root, demo);
  if (!script.empty()) LoadScript(script);

  const ULONGLONG started = GetTickCount64();
  ULONGLONG lastTitle = started;
  int frames = 0;
  std::vector<std::string> shots, screens;
  std::vector<std::pair<int, std::string>> delayed;  // window shots waiting for their frame
  while (!g_quit || !delayed.empty()) {  // a shot asked for just before quitting still gets its frame
    MSG msg;
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    if (!g_marker && GetTickCount64() - started > 1500) CreateMarker();
    // Window shots asked for two frames ago: their frame is the back buffer again now, with
    // everything the plugin drew into it in Present.
    for (auto it = delayed.begin(); it != delayed.end();) {
      if (--it->first > 0) {
        ++it;
        continue;
      }
      ID3D11Texture2D* back = nullptr;
      g_sc->GetBuffer(0, IID_PPV_ARGS(&back));
      printf("  shot %s: %s\n", it->second.c_str(), SaveTexture(back, nullptr, ShotPath(it->second)) ? "saved" : "FAILED");
      back->Release();
      it = delayed.erase(it);
    }
    if (!script.empty() && g_marker) RunScript(&shots, &screens);
    Render();
    // "screen" is the UI band of the marker as composed this frame.
    for (const std::string& name : shots) delayed.emplace_back(2, name);
    for (const std::string& name : screens) {
      if (name[0] == '@') {
        const std::string file = name.substr(1);
        printf("  advisor %s: %s\n", file.c_str(), g_advisor && SaveTexture(g_advisor, nullptr, ShotPath(file)) ? "saved" : "FAILED");
        continue;
      }
      const D3D11_BOX band{0, g_bandTop, 0, g_markerW, g_bandTop + g_bandH, 1};
      printf("  screen %s: %s\n", name.c_str(), g_marker && SaveTexture(g_marker, &band, ShotPath(name)) ? "saved" : "FAILED");
    }
    shots.clear();
    screens.clear();
    if (g_shotRequested) {
      g_shotRequested = false;
      SYSTEMTIME st;
      GetLocalTime(&st);
      char name[64];
      snprintf(name, sizeof name, "cab_%02d%02d%02d", st.wHour, st.wMinute, st.wSecond);
      ID3D11Texture2D* back = nullptr;
      g_sc->GetBuffer(0, IID_PPV_ARGS(&back));
      SaveTexture(back, nullptr, ShotPath(name));
      back->Release();
      printf("screenshot %s\n", Narrow(ShotPath(name)).c_str());
    }
    g_sc->Present(1, 0);
    ++frames;
    const ULONGLONG now = GetTickCount64();
    if (now - lastTitle >= 1000) {
      wchar_t title[160];
      swprintf_s(title, L"TruckPlay test kabini · %d fps · G basılı: dokun · Y: yaklaş · F10: görüntü · Esc: çık", frames);
      SetWindowTextW(g_hwnd, title);
      frames = 0;
      lastTitle = now;
    }
  }

  ClipToWindow(false);
  g_stop();
  if (g_job) CloseHandle(g_job);  // closes the host with us
  CoUninitialize();
  return 0;
}
