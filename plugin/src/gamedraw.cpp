#include "gamedraw.h"

#include <d3dcompiler.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <mutex>
#include <vector>

#include "json.h"
#include "log.h"
#include "telemetry.h"

namespace tp::gamedraw {
namespace {

template <typename T>
void SafeRelease(T*& p) {
  if (p) p->Release();
  p = nullptr;
}

double Now() {
  static LARGE_INTEGER freq = [] {
    LARGE_INTEGER f;
    QueryPerformanceFrequency(&f);
    return f;
  }();
  LARGE_INTEGER t;
  QueryPerformanceCounter(&t);
  return static_cast<double>(t.QuadPart) / static_cast<double>(freq.QuadPart);
}

// ---- views, by the resource they were made for ----
//
// An open-addressing table, written as views are created (any thread), read on every bind: a
// view's slot holds its resource. A reused address simply takes the slot over.

constexpr size_t kSlots = size_t{1} << 16;
struct Slot {
  std::atomic<uintptr_t> view{0};
  std::atomic<uintptr_t> res{0};
};
Slot g_slots[kSlots];

size_t Hash(uintptr_t p) {
  p >>= 4;
  p ^= p >> 21;
  p *= 0x9E3779B97F4A7C15ull;
  return static_cast<size_t>(p >> 40) & (kSlots - 1);
}

void Put(ID3D11ShaderResourceView* view, ID3D11Resource* res) {
  const auto key = reinterpret_cast<uintptr_t>(view);
  const size_t at = Hash(key);
  for (size_t k = 0; k < 8; ++k) {
    Slot& s = g_slots[(at + k) & (kSlots - 1)];
    const uintptr_t was = s.view.load(std::memory_order_acquire);
    if (was == key || was == 0) {
      s.res.store(reinterpret_cast<uintptr_t>(res), std::memory_order_relaxed);
      s.view.store(key, std::memory_order_release);
      return;
    }
  }
  Slot& s = g_slots[at];  // crowded: the oldest neighbour gives way
  s.view.store(0, std::memory_order_release);
  s.res.store(reinterpret_cast<uintptr_t>(res), std::memory_order_relaxed);
  s.view.store(key, std::memory_order_release);
}

ID3D11Resource* Get(ID3D11ShaderResourceView* view) {
  const auto key = reinterpret_cast<uintptr_t>(view);
  const size_t at = Hash(key);
  for (size_t k = 0; k < 8; ++k) {
    const Slot& s = g_slots[(at + k) & (kSlots - 1)];
    const uintptr_t was = s.view.load(std::memory_order_acquire);
    if (was == key) return reinterpret_cast<ID3D11Resource*>(s.res.load(std::memory_order_relaxed));
    if (was == 0) return nullptr;
  }
  return nullptr;
}

// ---- what the game draws (the render thread's own state) ----

std::atomic<uintptr_t> g_markerRes[8] = {};
std::atomic<unsigned> g_markerCount{0};

bool IsMarker(ID3D11Resource* res) {
  const unsigned n = g_markerCount.load(std::memory_order_acquire);
  const auto key = reinterpret_cast<uintptr_t>(res);
  for (unsigned i = 0; i < n; ++i)
    if (g_markerRes[i].load(std::memory_order_relaxed) == key) return true;
  return false;
}

ID3D11DeviceContext* g_ctx = nullptr;  // the game's immediate context
ID3D11Device* g_dev = nullptr;
ID3D11RenderTargetView* g_boundRtv = nullptr;  // the target drawn into now (not owned)
ID3D11ShaderResourceView* g_lastView = nullptr;  // the texture bound before this one…
ID3D11RenderTargetView* g_lastRtv = nullptr;     // …and the target it was drawn into
std::atomic<ID3D11Resource*> g_cabTarget{nullptr};  // the cab screen's render target (owned)
std::atomic<double> g_cabSeen{0}, g_markerSeen{0};
std::atomic<uint64_t> g_markerBinds{0}, g_cabBinds{0};

// ---- the game's map, as copied when it was last drawn ----

std::mutex g_mapMu;  // the copy is (re)made on the render thread and read in Present
ID3D11Texture2D* g_map = nullptr;
ID3D11ShaderResourceView* g_mapView = nullptr;
D3D11_TEXTURE2D_DESC g_mapDesc{};
bool g_mapLinear = false;  // a float format: its values are linear light
std::atomic<uint64_t> g_mapVersion{0};
std::atomic<double> g_mapSeen{0};
double g_mapSince = 0;  // when the map last came (Present thread)
bool g_mapRefused = false;  // logged once: a candidate that is not a map

DXGI_FORMAT Typeless(DXGI_FORMAT f) {
  switch (f) {
    case DXGI_FORMAT_R8G8B8A8_UNORM:
    case DXGI_FORMAT_R8G8B8A8_UNORM_SRGB:
    case DXGI_FORMAT_R8G8B8A8_TYPELESS:
      return DXGI_FORMAT_R8G8B8A8_TYPELESS;
    case DXGI_FORMAT_B8G8R8A8_UNORM:
    case DXGI_FORMAT_B8G8R8A8_UNORM_SRGB:
    case DXGI_FORMAT_B8G8R8A8_TYPELESS:
      return DXGI_FORMAT_B8G8R8A8_TYPELESS;
    case DXGI_FORMAT_B8G8R8X8_UNORM:
    case DXGI_FORMAT_B8G8R8X8_UNORM_SRGB:
    case DXGI_FORMAT_B8G8R8X8_TYPELESS:
      return DXGI_FORMAT_B8G8R8X8_TYPELESS;
    default:
      return f;
  }
}

// The view that reads the stored bytes as they are (an sRGB-encoded UI texture stays encoded).
DXGI_FORMAT RawView(DXGI_FORMAT typeless) {
  switch (typeless) {
    case DXGI_FORMAT_R8G8B8A8_TYPELESS:
      return DXGI_FORMAT_R8G8B8A8_UNORM;
    case DXGI_FORMAT_B8G8R8A8_TYPELESS:
      return DXGI_FORMAT_B8G8R8A8_UNORM;
    case DXGI_FORMAT_B8G8R8X8_TYPELESS:
      return DXGI_FORMAT_B8G8R8X8_UNORM;
    default:
      return typeless;
  }
}

bool IsFloat(DXGI_FORMAT f) {
  return f == DXGI_FORMAT_R16G16B16A16_FLOAT || f == DXGI_FORMAT_R11G11B10_FLOAT || f == DXGI_FORMAT_R32G32B32A32_FLOAT;
}

// The texture drawn just before the marker, into the cab screen's target: the game's map.
void CaptureMap(ID3D11DeviceContext* ctx, ID3D11ShaderResourceView* view) {
  ID3D11Resource* res = nullptr;
  view->GetResource(&res);
  if (!res) return;
  D3D11_RESOURCE_DIMENSION dim{};
  res->GetType(&dim);
  if (dim != D3D11_RESOURCE_DIMENSION_TEXTURE2D || IsMarker(res)) {
    res->Release();
    return;
  }
  auto* tex = static_cast<ID3D11Texture2D*>(res);
  D3D11_TEXTURE2D_DESC d{};
  tex->GetDesc(&d);
  // A map is drawn by the game (a render target) and has some size; a 4 x 4 white texture tinting
  // a background is not one.
  if (!(d.BindFlags & D3D11_BIND_RENDER_TARGET) || d.Width < 128 || d.Height < 128 || d.SampleDesc.Count != 1 ||
      d.ArraySize != 1) {
    if (!g_mapRefused) {
      g_mapRefused = true;
      TPLOG("game map: the texture before the marker is not one (%ux%u fmt=%d bind=0x%x samples=%u)", d.Width, d.Height,
            d.Format, d.BindFlags, d.SampleDesc.Count);
    }
    res->Release();
    return;
  }
  {
    std::lock_guard lock(g_mapMu);
    const DXGI_FORMAT typeless = Typeless(d.Format);
    if (!g_map || g_mapDesc.Width != d.Width || g_mapDesc.Height != d.Height || Typeless(g_mapDesc.Format) != typeless) {
      SafeRelease(g_mapView);
      SafeRelease(g_map);
      D3D11_TEXTURE2D_DESC c = d;
      c.MipLevels = 1;
      c.Format = typeless;
      c.Usage = D3D11_USAGE_DEFAULT;
      c.BindFlags = D3D11_BIND_SHADER_RESOURCE;
      c.CPUAccessFlags = 0;
      c.MiscFlags = 0;
      if (SUCCEEDED(g_dev->CreateTexture2D(&c, nullptr, &g_map))) {
        D3D11_SHADER_RESOURCE_VIEW_DESC v{};
        v.Format = RawView(typeless);
        v.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        v.Texture2D.MipLevels = 1;
        if (FAILED(g_dev->CreateShaderResourceView(g_map, &v, &g_mapView))) SafeRelease(g_map);
      }
      g_mapDesc = d;
      g_mapLinear = IsFloat(d.Format);
      TPLOG("game map: %ux%u fmt=%d mips=%u %s", d.Width, d.Height, d.Format, d.MipLevels, g_map ? "captured" : "COPY FAILED");
    }
    if (g_map) {
      ctx->CopySubresourceRegion(g_map, 0, 0, 0, 0, res, 0, nullptr);
      g_mapVersion.fetch_add(1, std::memory_order_release);
      g_mapSeen.store(Now(), std::memory_order_relaxed);
    }
  }
  res->Release();
}

// ---- the feed ----

struct FeedHeader {
  uint32_t magic;    // 'TPM1'
  uint32_t version;  // 1
  uint32_t front;    // the buffer last written whole
  uint32_t flags;    // bit 0: the plugin is writing
  uint64_t seq;
  uint32_t w[2], h[2];
  uint8_t reserved[24];
};
static_assert(sizeof(FeedHeader) == 64);
constexpr uint32_t kFeedMagic = 0x314D5054;  // 'TPM1'
constexpr uint32_t kFeedMax = 1024;
constexpr size_t kFeedBuf = size_t{kFeedMax} * kFeedMax * 4;

struct FeedAsk {
  bool on = false;
  bool premul = false;  // the map's colour is premultiplied by its alpha
};
std::mutex g_askMu;
FeedAsk g_ask;

HANDLE g_shm = nullptr;
uint8_t* g_shmBase = nullptr;
bool g_shmFailed = false;
ID3D11Texture2D* g_feedTex = nullptr;
ID3D11RenderTargetView* g_feedRtv = nullptr;
ID3D11Texture2D* g_staging[3] = {};
uint64_t g_stagingFrame[3] = {};
bool g_stagingFull[3] = {};
UINT g_feedW = 0, g_feedH = 0;
unsigned g_stagingNext = 0;
uint64_t g_present = 0;
double g_lastFeed = 0;
double g_lastDumpCheck = 0;
uint64_t g_fedVersion = 0;
bool g_readyWas = false;
ID3D11VertexShader* g_vs = nullptr;
ID3D11PixelShader* g_ps = nullptr;
ID3D11Buffer* g_cb = nullptr;
ID3D11SamplerState* g_sampler = nullptr;
uint64_t g_feeds = 0;

constexpr char kFeedShader[] = R"(
cbuffer Feed : register(b0) {
  float4 tap;  // x, y: a quarter of a feed pixel in the map's uv (0 at 1:1); z: 1 for a linear-light
               // map; w: 1 when the map's colour is premultiplied by its alpha
};
Texture2D map : register(t0);
SamplerState smp : register(s0);

struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };

V VS(uint id : SV_VertexID) {
  float2 uv = float2((id << 1) & 2, id & 2);
  V o;
  o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
  o.uv = uv;
  return o;
}

float4 Tap(float2 uv) {
  float4 c = map.Sample(smp, uv);
  if (tap.w < 0.5) c.rgb *= c.a;
  return c;
}

// The whole map, its colour straight (not premultiplied) and its alpha kept: the page colours it.
float4 PS(V i) : SV_Target {
  float4 c = (Tap(i.uv + float2(-tap.x, -tap.y)) + Tap(i.uv + float2(tap.x, -tap.y)) + Tap(i.uv + float2(-tap.x, tap.y)) +
              Tap(i.uv + float2(tap.x, tap.y))) * 0.25;
  float3 rgb = c.a > 1.0 / 512.0 ? c.rgb / c.a : float3(0, 0, 0);
  if (tap.z > 0.5) rgb = pow(saturate(rgb), 1.0 / 2.2);
  return float4(saturate(rgb), saturate(c.a));
}
)";

bool OpenShm() {
  if (g_shmBase) return true;
  if (g_shmFailed) return false;
  wchar_t name[128];
  wchar_t custom[96];
  if (GetEnvironmentVariableW(L"TRUCKPLAY_SHM", custom, 96) - 1 < 95) swprintf_s(name, L"Local\\%sMap", custom);
  else swprintf_s(name, L"Local\\TruckPlayMap");
  const uint64_t total = sizeof(FeedHeader) + 2 * kFeedBuf;
  g_shm = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, static_cast<DWORD>(total >> 32),
                             static_cast<DWORD>(total & 0xffffffff), name);
  if (!g_shm) {
    g_shmFailed = true;
    TPLOG("map feed %ls: CreateFileMapping failed (%lu)", name, GetLastError());
    return false;
  }
  g_shmBase = static_cast<uint8_t*>(MapViewOfFile(g_shm, FILE_MAP_ALL_ACCESS, 0, 0, 0));
  if (!g_shmBase) {
    g_shmFailed = true;
    CloseHandle(g_shm);
    g_shm = nullptr;
    TPLOG("map feed %ls: MapViewOfFile failed (%lu)", name, GetLastError());
    return false;
  }
  auto* h = reinterpret_cast<FeedHeader*>(g_shmBase);
  h->magic = kFeedMagic;
  h->version = 1;
  h->flags = 1;
  TPLOG("map feed %ls: shared memory ready", name);
  return true;
}

bool EnsureShaders() {
  if (g_vs && g_ps && g_cb && g_sampler) return true;
  ID3DBlob* vs = nullptr;
  ID3DBlob* ps = nullptr;
  ID3DBlob* err = nullptr;
  bool ok = SUCCEEDED(D3DCompile(kFeedShader, sizeof kFeedShader - 1, "truckplay_feed", nullptr, nullptr, "VS", "vs_5_0",
                                 D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, &vs, &err));
  SafeRelease(err);
  ok = ok && SUCCEEDED(D3DCompile(kFeedShader, sizeof kFeedShader - 1, "truckplay_feed", nullptr, nullptr, "PS", "ps_5_0",
                                  D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, &ps, &err));
  if (err) {
    TPLOG("map feed: shader: %s", static_cast<const char*>(err->GetBufferPointer()));
    SafeRelease(err);
  }
  if (ok) {
    g_dev->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &g_vs);
    g_dev->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, &g_ps);
  }
  SafeRelease(vs);
  SafeRelease(ps);
  D3D11_BUFFER_DESC cb{};
  cb.ByteWidth = 32;
  cb.Usage = D3D11_USAGE_DYNAMIC;
  cb.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
  cb.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
  if (!g_cb) g_dev->CreateBuffer(&cb, nullptr, &g_cb);
  D3D11_SAMPLER_DESC sd{};
  sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  sd.MaxLOD = D3D11_FLOAT32_MAX;
  if (!g_sampler) g_dev->CreateSamplerState(&sd, &g_sampler);
  return g_vs && g_ps && g_cb && g_sampler;
}

void ReleaseFeedTargets() {
  SafeRelease(g_feedRtv);
  SafeRelease(g_feedTex);
  for (auto*& s : g_staging) SafeRelease(s);
  for (bool& f : g_stagingFull) f = false;
  g_feedW = g_feedH = 0;
}

bool EnsureFeedTargets(UINT w, UINT h) {
  if (g_feedTex && g_feedW == w && g_feedH == h) return true;
  ReleaseFeedTargets();
  D3D11_TEXTURE2D_DESC d{};
  d.Width = w;
  d.Height = h;
  d.MipLevels = 1;
  d.ArraySize = 1;
  d.Format = DXGI_FORMAT_R8G8B8A8_UNORM;  // the bytes the page's ImageData takes as they are
  d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT;
  d.BindFlags = D3D11_BIND_RENDER_TARGET;
  if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &g_feedTex))) return false;
  g_dev->CreateRenderTargetView(g_feedTex, nullptr, &g_feedRtv);
  d.Usage = D3D11_USAGE_STAGING;
  d.BindFlags = 0;
  d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  for (auto*& s : g_staging) g_dev->CreateTexture2D(&d, nullptr, &s);
  g_feedW = w;
  g_feedH = h;
  const bool ok = g_feedRtv && g_staging[0] && g_staging[1] && g_staging[2];
  if (!ok) ReleaseFeedTargets();
  return ok;
}

// Everything the feed's draw touches, so the game's next draw sees its own pipeline again.
struct State {
  D3D11_VIEWPORT vp[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE];
  UINT vpCount;
  ID3D11RenderTargetView* rtv[D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT];
  ID3D11DepthStencilView* dsv;
  ID3D11BlendState* blend;
  FLOAT blendFactor[4];
  UINT sampleMask;
  ID3D11DepthStencilState* depth;
  UINT stencilRef;
  ID3D11RasterizerState* rs;
  ID3D11VertexShader* vs;
  ID3D11PixelShader* ps;
  ID3D11GeometryShader* gs;
  ID3D11Buffer* psCb;
  ID3D11ShaderResourceView* psSrv;
  ID3D11SamplerState* psSampler;
  ID3D11InputLayout* layout;
  D3D11_PRIMITIVE_TOPOLOGY topology;
};

void Save(ID3D11DeviceContext* c, State& s) {
  s.vpCount = D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
  c->RSGetViewports(&s.vpCount, s.vp);
  c->OMGetRenderTargets(D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT, s.rtv, &s.dsv);
  c->OMGetBlendState(&s.blend, s.blendFactor, &s.sampleMask);
  c->OMGetDepthStencilState(&s.depth, &s.stencilRef);
  c->RSGetState(&s.rs);
  c->VSGetShader(&s.vs, nullptr, nullptr);
  c->PSGetShader(&s.ps, nullptr, nullptr);
  c->GSGetShader(&s.gs, nullptr, nullptr);
  c->PSGetConstantBuffers(0, 1, &s.psCb);
  c->PSGetShaderResources(0, 1, &s.psSrv);
  c->PSGetSamplers(0, 1, &s.psSampler);
  c->IAGetInputLayout(&s.layout);
  c->IAGetPrimitiveTopology(&s.topology);
}

void Restore(ID3D11DeviceContext* c, State& s) {
  c->RSSetViewports(s.vpCount, s.vp);
  c->OMSetRenderTargets(D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT, s.rtv, s.dsv);
  c->OMSetBlendState(s.blend, s.blendFactor, s.sampleMask);
  c->OMSetDepthStencilState(s.depth, s.stencilRef);
  c->RSSetState(s.rs);
  c->VSSetShader(s.vs, nullptr, 0);
  c->PSSetShader(s.ps, nullptr, 0);
  c->GSSetShader(s.gs, nullptr, 0);
  c->PSSetConstantBuffers(0, 1, &s.psCb);
  c->PSSetShaderResources(0, 1, &s.psSrv);
  c->PSSetSamplers(0, 1, &s.psSampler);
  c->IASetInputLayout(s.layout);
  c->IASetPrimitiveTopology(s.topology);
  for (auto*& r : s.rtv) SafeRelease(r);
  SafeRelease(s.dsv);
  SafeRelease(s.blend);
  SafeRelease(s.depth);
  SafeRelease(s.rs);
  SafeRelease(s.vs);
  SafeRelease(s.ps);
  SafeRelease(s.gs);
  SafeRelease(s.psCb);
  SafeRelease(s.psSrv);
  SafeRelease(s.psSampler);
  SafeRelease(s.layout);
}

// The captured map as it is, raw texels with a small text header, for working out the game's map
// colours away from the game (the test cab shows such a file with --baremap). Written by itself once
// a session some seconds after the map comes (bare-map.bin) and once while the game routes
// (bare-map-route.bin), and whenever asked (a file named "dump-map" next to the log). Called with
// the map's lock held.
bool g_dumpedPlain = false, g_dumpedRoute = false;

void DumpMap(double mapSince) {
  if (!g_map) return;
  const std::wstring dir = PluginDataDir();
  const std::wstring ask = dir + L"\\dump-map";
  const wchar_t* name = nullptr;
  if (GetFileAttributesW(ask.c_str()) != INVALID_FILE_ATTRIBUTES) {
    DeleteFileW(ask.c_str());
    name = L"bare-map-asked.bin";
  } else if (mapSince > 8.0 && !g_dumpedRoute && TelemetryNavDistance() > 100.0f) {
    g_dumpedRoute = true;
    name = L"bare-map-route.bin";
  } else if (mapSince > 8.0 && !g_dumpedPlain) {
    g_dumpedPlain = true;
    name = L"bare-map.bin";
  }
  if (!name) return;
  D3D11_TEXTURE2D_DESC d{};
  g_map->GetDesc(&d);
  d.Usage = D3D11_USAGE_STAGING;
  d.BindFlags = 0;
  d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  d.MiscFlags = 0;
  ID3D11Texture2D* copy = nullptr;
  if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &copy))) {
    TPLOG("dump-map: no staging copy");
    return;
  }
  g_ctx->CopyResource(copy, g_map);
  D3D11_MAPPED_SUBRESOURCE m{};
  if (SUCCEEDED(g_ctx->Map(copy, 0, D3D11_MAP_READ, 0, &m))) {
    const unsigned bpp = d.Format == DXGI_FORMAT_R16G16B16A16_TYPELESS || d.Format == DXGI_FORMAT_R16G16B16A16_FLOAT ? 8 : 4;
    const std::wstring path = dir + L"\\" + name;
    if (FILE* f = _wfopen(path.c_str(), L"wb")) {
      char head[128] = {};
      snprintf(head, sizeof head, "TPMAP %u %u %d %u %d\n", d.Width, d.Height, static_cast<int>(g_mapDesc.Format), bpp,
               g_mapLinear ? 1 : 0);
      fwrite(head, 1, sizeof head, f);
      for (UINT y = 0; y < d.Height; ++y) fwrite(static_cast<const uint8_t*>(m.pData) + y * m.RowPitch, 1, size_t{d.Width} * bpp, f);
      fclose(f);
      TPLOG("dump-map: %ls %ux%u fmt=%d written", name, d.Width, d.Height, g_mapDesc.Format);
    }
    g_ctx->Unmap(copy, 0);
  }
  copy->Release();
}

// The newest staging copy that the GPU has finished, into the shared memory.
void Publish() {
  auto* hdr = reinterpret_cast<FeedHeader*>(g_shmBase);
  for (unsigned k = 0; k < 3; ++k) {
    const unsigned i = (g_stagingNext + k) % 3;  // oldest first
    if (!g_stagingFull[i] || g_present - g_stagingFrame[i] < 2) continue;
    D3D11_MAPPED_SUBRESOURCE m{};
    if (FAILED(g_ctx->Map(g_staging[i], 0, D3D11_MAP_READ, D3D11_MAP_FLAG_DO_NOT_WAIT, &m))) continue;
    const uint32_t back = 1 - (hdr->front & 1);
    uint8_t* dst = g_shmBase + sizeof(FeedHeader) + back * kFeedBuf;
    const size_t row = size_t{g_feedW} * 4;
    for (UINT y = 0; y < g_feedH; ++y) memcpy(dst + y * row, static_cast<const uint8_t*>(m.pData) + y * m.RowPitch, row);
    g_ctx->Unmap(g_staging[i], 0);
    g_stagingFull[i] = false;
    hdr->w[back] = g_feedW;
    hdr->h[back] = g_feedH;
    MemoryBarrier();
    hdr->front = back;
    MemoryBarrier();
    hdr->seq = hdr->seq + 1;
    ++g_feeds;
    return;
  }
}

}  // namespace

void OnViewCreated(ID3D11Resource* res, ID3D11ShaderResourceView* srv) {
  if (res && srv) Put(srv, res);
}

void OnRenderTargets(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* rtv) {
  if (ctx == g_ctx) g_boundRtv = rtv;
}

void OnShaderResources(ID3D11DeviceContext* ctx, UINT start, UINT count, ID3D11ShaderResourceView* const* views) {
  if (ctx != g_ctx || !views || !count) return;
  ID3D11Resource* cab = g_cabTarget.load(std::memory_order_relaxed);
  for (UINT i = 0; i < count; ++i) {
    ID3D11ShaderResourceView* view = views[i];
    if (!view) continue;
    ID3D11Resource* res = Get(view);
    if (!res) continue;
    if (res == cab && cab) {
      g_cabSeen.store(Now(), std::memory_order_relaxed);
      g_cabBinds.fetch_add(1, std::memory_order_relaxed);
      continue;
    }
    if (start + i != 0 || !IsMarker(res)) continue;
    // The GPS script draws the marker: into the cab screen's target, right after the game's map.
    g_markerSeen.store(Now(), std::memory_order_relaxed);
    g_markerBinds.fetch_add(1, std::memory_order_relaxed);
    if (!cab && g_boundRtv) {
      ID3D11Resource* target = nullptr;
      g_boundRtv->GetResource(&target);
      if (target) {
        g_cabTarget.store(target, std::memory_order_release);
        cab = target;
        TPLOG("cab view: the GPS screen draws into %p", static_cast<void*>(target));
      }
    }
    if (g_lastView && g_lastView != view && g_lastRtv == g_boundRtv) CaptureMap(ctx, g_lastView);
  }
  if (start == 0 && views[0]) {
    g_lastView = views[0];
    g_lastRtv = g_boundRtv;
  }
}

void SetMarkers(ID3D11Resource* const* textures, unsigned count) {
  count = std::min(count, 8u);
  g_markerCount.store(0, std::memory_order_release);
  for (unsigned i = 0; i < count; ++i) g_markerRes[i].store(reinterpret_cast<uintptr_t>(textures[i]), std::memory_order_relaxed);
  g_markerCount.store(count, std::memory_order_release);
}

void Init(ID3D11Device* device, ID3D11DeviceContext* ctx) {
  g_dev = device;
  g_ctx = ctx;
}

void Shutdown() {
  {
    std::lock_guard lock(g_mapMu);
    SafeRelease(g_mapView);
    SafeRelease(g_map);
  }
  ReleaseFeedTargets();
  SafeRelease(g_vs);
  SafeRelease(g_ps);
  SafeRelease(g_cb);
  SafeRelease(g_sampler);
  if (ID3D11Resource* cab = g_cabTarget.exchange(nullptr)) cab->Release();
  if (g_shmBase) {
    reinterpret_cast<FeedHeader*>(g_shmBase)->flags = 0;
    UnmapViewOfFile(g_shmBase);
  }
  if (g_shm) CloseHandle(g_shm);
  g_shmBase = nullptr;
  g_shm = nullptr;
  g_ctx = nullptr;
  g_dev = nullptr;
}

bool CabInView() {
  const double now = Now();
  const double cab = g_cabSeen.load(std::memory_order_relaxed);
  // Until the cab's screen has been seen sampled, the marker being drawn at all stands in (the test
  // cab, or a truck whose screen is sampled through a copy).
  if (cab > 0) return now - cab < 0.25;
  const double marker = g_markerSeen.load(std::memory_order_relaxed);
  return marker > 0 && now - marker < 0.25;
}

void SetFeed(bool on, bool premul) {
  std::lock_guard lock(g_askMu);
  g_ask = {on, premul};
}

std::string ProduceFeed() {
  ++g_present;
  if (!g_ctx || !g_dev) return {};
  const double now = Now();
  const bool ready = g_mapSeen.load(std::memory_order_relaxed) > 0 && now - g_mapSeen.load(std::memory_order_relaxed) < 3.0;
  std::string status;
  if (ready != g_readyWas) {
    g_readyWas = ready;
    std::lock_guard lock(g_mapMu);
    JsonWriter w;
    w.beginObject().str("t", "mapfeed").boolean("ready", ready).integer("w", g_mapDesc.Width).integer("h", g_mapDesc.Height).endObject();
    status = w.text();
    TPLOG("game map: %s", ready ? "available" : "gone");
    if (ready) g_mapSince = now;
  }
  FeedAsk ask;
  {
    std::lock_guard lock(g_askMu);
    ask = g_ask;
  }
  if (now - g_lastDumpCheck > 1.0) {
    g_lastDumpCheck = now;
    std::lock_guard lock(g_mapMu);
    DumpMap(ready ? now - g_mapSince : 0.0);
  }
  if (!ask.on || !ready || !OpenShm()) return status;
  if (g_shmBase) Publish();
  const uint64_t version = g_mapVersion.load(std::memory_order_acquire);
  if (version == g_fedVersion || now - g_lastFeed < 1.0 / 30.0) return status;
  if (!EnsureShaders()) return status;

  std::lock_guard lock(g_mapMu);
  if (!g_mapView) return status;
  // The whole map, at its own size (halved while larger than the feed holds): the page crops,
  // zooms and colours it itself, at its own pace.
  UINT fw = g_mapDesc.Width, fh = g_mapDesc.Height;
  while (fw > kFeedMax || fh > kFeedMax) {
    fw = std::max(1u, fw / 2);
    fh = std::max(1u, fh / 2);
  }
  if (!EnsureFeedTargets(fw, fh)) return status;
  const bool half = fw != g_mapDesc.Width;

  struct {
    float tap[4];
  } p{{half ? 0.25f / fw : 0.0f, half ? 0.25f / fh : 0.0f, g_mapLinear ? 1.0f : 0.0f, ask.premul ? 1.0f : 0.0f}};
  State s{};
  Save(g_ctx, s);
  D3D11_MAPPED_SUBRESOURCE m;
  if (SUCCEEDED(g_ctx->Map(g_cb, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
    memcpy(m.pData, &p, sizeof p);
    g_ctx->Unmap(g_cb, 0);
  }
  const D3D11_VIEWPORT vp{0, 0, static_cast<float>(fw), static_cast<float>(fh), 0, 1};
  const float blendFactor[4] = {0, 0, 0, 0};
  g_ctx->OMSetRenderTargets(1, &g_feedRtv, nullptr);
  g_ctx->OMSetBlendState(nullptr, blendFactor, 0xffffffff);
  g_ctx->OMSetDepthStencilState(nullptr, 0);
  g_ctx->RSSetState(nullptr);
  g_ctx->RSSetViewports(1, &vp);
  g_ctx->IASetInputLayout(nullptr);
  g_ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  g_ctx->VSSetShader(g_vs, nullptr, 0);
  g_ctx->GSSetShader(nullptr, nullptr, 0);
  g_ctx->PSSetShader(g_ps, nullptr, 0);
  g_ctx->PSSetConstantBuffers(0, 1, &g_cb);
  g_ctx->PSSetShaderResources(0, 1, &g_mapView);
  g_ctx->PSSetSamplers(0, 1, &g_sampler);
  g_ctx->Draw(3, 0);
  Restore(g_ctx, s);

  const unsigned slot = g_stagingNext;
  g_ctx->CopyResource(g_staging[slot], g_feedTex);
  g_stagingFrame[slot] = g_present;
  g_stagingFull[slot] = true;
  g_stagingNext = (slot + 1) % 3;
  g_fedVersion = version;
  g_lastFeed = now;
  return status;
}

std::string Status() {
  std::lock_guard lock(g_mapMu);
  JsonWriter w;
  w.beginObject().str("t", "mapfeed").boolean("ready", g_readyWas).integer("w", g_mapDesc.Width).integer("h", g_mapDesc.Height).endObject();
  return w.text();
}

std::string Diagnostics() {
  const double now = Now();
  const double cab = g_cabSeen.load(), marker = g_markerSeen.load(), map = g_mapSeen.load();
  char line[256];
  snprintf(line, sizeof line, "cab %s (seen %.1fs ago, %llu binds), marker %.1fs ago (%llu binds), map %s, feed %llu frames",
           CabInView() ? "in" : "out", cab > 0 ? now - cab : -1.0, static_cast<unsigned long long>(g_cabBinds.load()),
           marker > 0 ? now - marker : -1.0, static_cast<unsigned long long>(g_markerBinds.load()),
           map > 0 ? (now - map < 3.0 ? "live" : "stale") : "never seen", static_cast<unsigned long long>(g_feeds));
  return line;
}

}  // namespace tp::gamedraw
