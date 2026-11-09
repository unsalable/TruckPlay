#include "overlay.h"

#include <d3dcompiler.h>

#include <algorithm>
#include <cmath>
#include <cstring>

#include "log.h"

namespace tp::overlay {
namespace {

constexpr char kShader[] = R"(
cbuffer Params : register(b0) {
  float4 panel;   // x, y, w, h in pixels
  float4 view;    // viewport w, h, corner radius, panel opacity
  float4 extra;   // dim amount, shadow size, shadow strength, unused
  float4 crop;    // the part of the frame shown: u0, v0, u1, v1
};
Texture2D frame : register(t0);
SamplerState smp : register(s0);

struct V { float4 pos : SV_Position; float2 px : TEXCOORD0; };

V VS(uint id : SV_VertexID) {
  float2 uv = float2((id << 1) & 2, id & 2);
  V o;
  o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
  o.px = uv * view.xy;
  return o;
}

float RoundBox(float2 p, float2 halfSize, float r) {
  float2 q = abs(p) - halfSize + r;
  return length(max(q, 0)) + min(max(q.x, q.y), 0) - r;
}

float4 PS(V i) : SV_Target {
  float2 center = panel.xy + panel.zw * 0.5;
  float d = RoundBox(i.px - center, panel.zw * 0.5, view.z);
  // Outside: dim the game and lay a soft shadow under the panel.
  float shadow = extra.z * (1 - smoothstep(-view.z * 0.5, extra.y, d));
  float outsideA = saturate(extra.x + shadow * (1 - extra.x)) * view.w;
  float coverage = saturate(0.5 - d);
  float2 uv = lerp(crop.xy, crop.zw, saturate((i.px - panel.xy) / panel.zw));
  float3 rgb = frame.Sample(smp, uv).rgb;
  return float4(rgb * coverage * view.w, lerp(outsideA, view.w, coverage));
}
)";

// The pointer, iPadOS style. It adapts to what is behind it: over dark content a light disc is
// added on top (with a faint rim), over light content a grey disc is multiplied in, the same two
// treatments the UI's CSS pointer uses for dark and light appearance. Over an app icon it becomes
// a focus ring instead: a bright band hugging the icon with a soft shadow outside, legible on any
// wallpaper.
constexpr char kPointerShader[] = R"(
cbuffer Pointer : register(b0) {
  float4 shape;  // centre x, y and half width, height in target pixels
  float4 look;   // corner radius, alpha, rim width, ring amount (0 disc/plate … 1 focus ring)
};
Texture2D base : register(t0);

float4 VS(uint id : SV_VertexID) : SV_Position {
  float2 uv = float2((id << 1) & 2, id & 2);
  return float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
}

float RoundBox(float2 p, float2 halfSize, float r) {
  float2 q = abs(p) - halfSize + r;
  return length(max(q, 0)) + min(max(q.x, q.y), 0) - r;
}

float Luma(float2 p) {
  return dot(base.Load(int3(int2(p), 0)).rgb, float3(0.2126, 0.7152, 0.0722));
}

float4 PS(float4 pos : SV_Position) : SV_Target {
  float4 b = base.Load(int3(int2(pos.xy), 0));
  float reach = max(shape.z, shape.w) + 4;
  float lum = Luma(shape.xy);
  [unroll] for (int i = 0; i < 8; ++i) {
    float a = i * 0.7853982;
    lum += Luma(shape.xy + float2(cos(a), sin(a)) * reach);
  }
  float onDark = 1 - smoothstep(0.42, 0.66, lum / 9);
  float d = RoundBox(pos.xy - shape.xy, shape.zw, look.x);
  float fill = saturate(0.5 - d) * look.y;
  float rim = max(0, saturate(0.5 - (d - look.z)) * look.y - fill);
  float3 lighter = b.rgb + float3(0.8627, 0.8627, 0.902) * 0.4 * fill + 0.18 * rim;
  float3 darker = b.rgb * (1 - 0.28 * fill * (1 - float3(0.2353, 0.2353, 0.2627)));
  float3 disc = lerp(darker, lighter, onDark);
  // Focus ring: a band just inside the edge, a shadow just outside it.
  float w = max(look.z * 3.4, 2.0);
  float band = saturate(w * 0.5 + 0.5 - abs(d + w * 0.5)) * look.y;
  float shadow = (d > 0 ? exp(-d / (w * 1.3)) : 0) * 0.45 * look.y;
  float3 ring = lerp(b.rgb * (1 - shadow), float3(1, 1, 1), band * 0.96);
  return float4(saturate(lerp(disc, ring, look.w)), b.a);
}
)";

// The route advisor's TruckPlay panel: the composed frame drawn into the panel's marker texture
// at its own proportions, with rounded corners, four taps per pixel (the frame is a few times
// larger than the panel), on a fill colour; the panel's own corners rounded. Straight alpha, as the
// game's UI images are.
constexpr char kFitShader[] = R"(
cbuffer Fit : register(b0) {
  float4 rect;   // where the frame goes in the target, pixels: l, t, r, b
  float4 tap;    // x, y: a quarter of a target pixel in the frame's uv; z: corner radius (px); w: opacity
  float4 fill;   // around the frame (straight alpha)
  float4 panel;  // x, y: the target's size (px); z: the panel's corner radius (px); w: glow 0…1
  float4 src;    // the part of the frame drawn: u0, v0, u1, v1
};
Texture2D frame : register(t0);
SamplerState smp : register(s0);

struct V { float4 pos : SV_Position; };

V VS(uint id : SV_VertexID) {
  float2 uv = float2((id << 1) & 2, id & 2);
  V o;
  o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
  return o;
}

float Rounded(float2 p, float2 centre, float2 half, float r) {
  float2 q = abs(p - centre) - half + r;
  float d = length(max(q, 0)) + min(max(q.x, q.y), 0) - r;
  return saturate(0.5 - d);
}

float4 PS(V i) : SV_Target {
  float outer = Rounded(i.pos.xy, panel.xy * 0.5, panel.xy * 0.5, panel.z) * tap.w;
  if (outer <= 0) return 0;
  float2 size = rect.zw - rect.xy;
  float inner = Rounded(i.pos.xy, (rect.xy + rect.zw) * 0.5, size * 0.5, tap.z);
  float2 local = (i.pos.xy - rect.xy) / size;
  float2 uv = lerp(src.xy, src.zw, local);
  float3 c = frame.Sample(smp, uv + float2(-tap.x, -tap.y)).rgb + frame.Sample(smp, uv + float2(tap.x, -tap.y)).rgb +
             frame.Sample(smp, uv + float2(-tap.x, tap.y)).rgb + frame.Sample(smp, uv + float2(tap.x, tap.y)).rgb;
  // Around the picture (when it does not fill the panel): its own colours near the edge, soft and
  // dim, fading out into the fill, as a screen's light spills onto the glass around it.
  float4 around = fill;
  if (panel.w > 0 && inner < 1) {
    // The average colour of the picture's band along the closest edge: one soft colour for the whole
    // side, so the light does not run in streaks.
    float2 near = clamp(local, 0.0, 1.0);
    bool sides = local.y >= 0.0 && local.y <= 1.0;  // left or right of the picture, else above or below
    float edge = sides ? (local.x < 0.0 ? 0.04 : 0.96) : (local.y < 0.0 ? 0.04 : 0.96);
    float3 amb = 0;
    [unroll] for (int k = 0; k < 16; k++) {
      float t = 0.03 + k * 0.0627;
      float2 at = sides ? float2(edge, t) : float2(t, edge);
      amb += frame.SampleLevel(smp, lerp(src.xy, src.zw, at), 0).rgb;
    }
    amb /= 16.0;
    float2 q = max(rect.xy - i.pos.xy, i.pos.xy - rect.zw);
    float away = max(max(q.x, q.y), 0);
    float k2 = panel.w * exp(-away / (panel.y * 0.16));
    around = float4(lerp(fill.rgb, amb * 0.55, k2), fill.a);
  }
  float4 shown = lerp(around, float4(c * 0.25, 1), inner);
  return float4(shown.rgb, shown.a * outer);
}
)";

struct Params {
  float panel[4];
  float view[4];
  float extra[4];
  float crop[4];
};

struct FitParams {
  float rect[4];
  float tap[4];
  float fill[4];
  float panel[4];
  float src[4];
};

struct PointerParams {
  float shape[4];
  float look[4];
};

ID3D11Device* g_dev = nullptr;
ID3D11VertexShader* g_vs = nullptr;
ID3D11PixelShader* g_ps = nullptr;
ID3D11VertexShader* g_pointerVs = nullptr;
ID3D11PixelShader* g_pointerPs = nullptr;
ID3D11Buffer* g_pointerCb = nullptr;
ID3D11VertexShader* g_fitVs = nullptr;
ID3D11PixelShader* g_fitPs = nullptr;
ID3D11Buffer* g_fitCb = nullptr;
ID3D11Buffer* g_cb = nullptr;
ID3D11SamplerState* g_sampler = nullptr;
ID3D11BlendState* g_blend = nullptr;
ID3D11RasterizerState* g_raster = nullptr;
ID3D11DepthStencilState* g_depth = nullptr;
ID3D11RenderTargetView* g_rtv = nullptr;
DXGI_FORMAT g_rtvFormat = DXGI_FORMAT_UNKNOWN;
bool g_failed = false;

template <typename T>
void SafeRelease(T*& p) {
  if (p) p->Release();
  p = nullptr;
}

bool IsSrgb(DXGI_FORMAT f) {
  return f == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB || f == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB ||
         f == DXGI_FORMAT_B8G8R8X8_UNORM_SRGB;
}
bool IsLinearFloat(DXGI_FORMAT f) { return f == DXGI_FORMAT_R16G16B16A16_FLOAT || f == DXGI_FORMAT_R11G11B10_FLOAT; }

template <size_t N>
bool Compile(const char (&source)[N], const char* entry, const char* target, ID3DBlob** out) {
  ID3DBlob* errors = nullptr;
  const HRESULT hr = D3DCompile(source, N - 1, "tirplay_overlay", nullptr, nullptr, entry, target,
                                D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, out, &errors);
  if (FAILED(hr)) {
    TPLOG("overlay: %s compile failed: %s", entry, errors ? static_cast<const char*>(errors->GetBufferPointer()) : "?");
    SafeRelease(errors);
    return false;
  }
  SafeRelease(errors);
  return true;
}

// Everything Draw touches, so the game's next draw sees its own pipeline again.
struct Backup {
  UINT scissorCount, viewportCount;
  D3D11_RECT scissors[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE];
  D3D11_VIEWPORT viewports[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE];
  ID3D11RasterizerState* rs;
  ID3D11BlendState* blend;
  FLOAT blendFactor[4];
  UINT sampleMask;
  UINT stencilRef;
  ID3D11DepthStencilState* depth;
  ID3D11ShaderResourceView* psSrv;
  ID3D11SamplerState* psSampler;
  ID3D11PixelShader* ps;
  ID3D11VertexShader* vs;
  ID3D11GeometryShader* gs;
  ID3D11HullShader* hs;
  ID3D11DomainShader* ds;
  ID3D11Buffer* vsCb;
  ID3D11Buffer* psCb;
  D3D11_PRIMITIVE_TOPOLOGY topology;
  ID3D11Buffer* ib;
  DXGI_FORMAT ibFormat;
  UINT ibOffset;
  ID3D11Buffer* vb;
  UINT vbStride, vbOffset;
  ID3D11InputLayout* layout;
  ID3D11RenderTargetView* rtvs[D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT];
  ID3D11DepthStencilView* dsv;
};

void Save(ID3D11DeviceContext* c, Backup& b) {
  b.scissorCount = b.viewportCount = D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
  c->RSGetScissorRects(&b.scissorCount, b.scissors);
  c->RSGetViewports(&b.viewportCount, b.viewports);
  c->RSGetState(&b.rs);
  c->OMGetBlendState(&b.blend, b.blendFactor, &b.sampleMask);
  c->OMGetDepthStencilState(&b.depth, &b.stencilRef);
  c->OMGetRenderTargets(D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT, b.rtvs, &b.dsv);
  c->PSGetShaderResources(0, 1, &b.psSrv);
  c->PSGetSamplers(0, 1, &b.psSampler);
  c->PSGetShader(&b.ps, nullptr, nullptr);
  c->VSGetShader(&b.vs, nullptr, nullptr);
  c->GSGetShader(&b.gs, nullptr, nullptr);
  c->HSGetShader(&b.hs, nullptr, nullptr);
  c->DSGetShader(&b.ds, nullptr, nullptr);
  c->VSGetConstantBuffers(0, 1, &b.vsCb);
  c->PSGetConstantBuffers(0, 1, &b.psCb);
  c->IAGetPrimitiveTopology(&b.topology);
  c->IAGetIndexBuffer(&b.ib, &b.ibFormat, &b.ibOffset);
  c->IAGetVertexBuffers(0, 1, &b.vb, &b.vbStride, &b.vbOffset);
  c->IAGetInputLayout(&b.layout);
}

void Restore(ID3D11DeviceContext* c, Backup& b) {
  c->RSSetScissorRects(b.scissorCount, b.scissors);
  c->RSSetViewports(b.viewportCount, b.viewports);
  c->RSSetState(b.rs);
  c->OMSetBlendState(b.blend, b.blendFactor, b.sampleMask);
  c->OMSetDepthStencilState(b.depth, b.stencilRef);
  c->OMSetRenderTargets(D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT, b.rtvs, b.dsv);
  c->PSSetShaderResources(0, 1, &b.psSrv);
  c->PSSetSamplers(0, 1, &b.psSampler);
  c->PSSetShader(b.ps, nullptr, 0);
  c->VSSetShader(b.vs, nullptr, 0);
  c->GSSetShader(b.gs, nullptr, 0);
  c->HSSetShader(b.hs, nullptr, 0);
  c->DSSetShader(b.ds, nullptr, 0);
  c->VSSetConstantBuffers(0, 1, &b.vsCb);
  c->PSSetConstantBuffers(0, 1, &b.psCb);
  c->IASetPrimitiveTopology(b.topology);
  c->IASetIndexBuffer(b.ib, b.ibFormat, b.ibOffset);
  c->IASetVertexBuffers(0, 1, &b.vb, &b.vbStride, &b.vbOffset);
  c->IASetInputLayout(b.layout);
  SafeRelease(b.rs);
  SafeRelease(b.blend);
  SafeRelease(b.depth);
  for (auto*& r : b.rtvs) SafeRelease(r);
  SafeRelease(b.dsv);
  SafeRelease(b.psSrv);
  SafeRelease(b.psSampler);
  SafeRelease(b.ps);
  SafeRelease(b.vs);
  SafeRelease(b.gs);
  SafeRelease(b.hs);
  SafeRelease(b.ds);
  SafeRelease(b.vsCb);
  SafeRelease(b.psCb);
  SafeRelease(b.ib);
  SafeRelease(b.vb);
  SafeRelease(b.layout);
}

bool EnsureTarget(IDXGISwapChain* sc) {
  if (g_rtv) return true;
  ID3D11Texture2D* back = nullptr;
  if (FAILED(sc->GetBuffer(0, IID_PPV_ARGS(&back)))) return false;
  D3D11_TEXTURE2D_DESC bd;
  back->GetDesc(&bd);
  D3D11_RENDER_TARGET_VIEW_DESC rd{};
  rd.Format = bd.Format;
  if (rd.Format == DXGI_FORMAT_R8G8B8A8_TYPELESS) rd.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  if (rd.Format == DXGI_FORMAT_B8G8R8A8_TYPELESS) rd.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  rd.ViewDimension = bd.SampleDesc.Count > 1 ? D3D11_RTV_DIMENSION_TEXTURE2DMS : D3D11_RTV_DIMENSION_TEXTURE2D;
  const HRESULT hr = g_dev->CreateRenderTargetView(back, &rd, &g_rtv);
  back->Release();
  if (FAILED(hr)) {
    TPLOG("overlay: back buffer view failed (fmt %d, hr 0x%08lx)", bd.Format, hr);
    return false;
  }
  g_rtvFormat = rd.Format;
  TPLOG("overlay: back buffer %ux%u fmt=%d", bd.Width, bd.Height, bd.Format);
  return true;
}

}  // namespace

bool Init(ID3D11Device* device) {
  g_dev = device;
  ID3DBlob* vs = nullptr;
  ID3DBlob* ps = nullptr;
  if (!Compile(kShader, "VS", "vs_5_0", &vs) || !Compile(kShader, "PS", "ps_5_0", &ps)) {
    SafeRelease(vs);
    g_failed = true;
    return false;
  }
  device->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &g_vs);
  device->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, &g_ps);
  SafeRelease(vs);
  SafeRelease(ps);
  if (Compile(kPointerShader, "VS", "vs_5_0", &vs) && Compile(kPointerShader, "PS", "ps_5_0", &ps)) {
    device->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &g_pointerVs);
    device->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, &g_pointerPs);
  }
  SafeRelease(vs);
  SafeRelease(ps);
  if (Compile(kFitShader, "VS", "vs_5_0", &vs) && Compile(kFitShader, "PS", "ps_5_0", &ps)) {
    device->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, &g_fitVs);
    device->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, &g_fitPs);
  }
  SafeRelease(vs);
  SafeRelease(ps);

  D3D11_BUFFER_DESC cb{};
  cb.ByteWidth = sizeof(Params);
  cb.Usage = D3D11_USAGE_DYNAMIC;
  cb.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
  cb.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
  device->CreateBuffer(&cb, nullptr, &g_cb);
  cb.ByteWidth = sizeof(PointerParams);
  device->CreateBuffer(&cb, nullptr, &g_pointerCb);
  cb.ByteWidth = sizeof(FitParams);
  device->CreateBuffer(&cb, nullptr, &g_fitCb);

  D3D11_SAMPLER_DESC sd{};
  sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  sd.MaxLOD = D3D11_FLOAT32_MAX;
  device->CreateSamplerState(&sd, &g_sampler);

  D3D11_BLEND_DESC bd{};
  bd.RenderTarget[0].BlendEnable = TRUE;
  bd.RenderTarget[0].SrcBlend = D3D11_BLEND_ONE;  // shader outputs premultiplied colour
  bd.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
  bd.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
  bd.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
  bd.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
  bd.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
  bd.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
  device->CreateBlendState(&bd, &g_blend);

  D3D11_RASTERIZER_DESC rd{};
  rd.FillMode = D3D11_FILL_SOLID;
  rd.CullMode = D3D11_CULL_NONE;
  rd.DepthClipEnable = TRUE;
  device->CreateRasterizerState(&rd, &g_raster);

  D3D11_DEPTH_STENCIL_DESC dd{};
  dd.DepthEnable = FALSE;
  dd.StencilEnable = FALSE;
  device->CreateDepthStencilState(&dd, &g_depth);

  g_failed = !(g_vs && g_ps && g_cb && g_sampler && g_blend && g_raster && g_depth);
  TPLOG("overlay: %s, pointer %s", g_failed ? "init FAILED" : "ready", g_pointerVs && g_pointerPs && g_pointerCb ? "ready" : "FAILED");
  return !g_failed;
}

void ReleaseTarget() { SafeRelease(g_rtv); }

void Shutdown() {
  ReleaseTarget();
  SafeRelease(g_vs);
  SafeRelease(g_ps);
  SafeRelease(g_pointerVs);
  SafeRelease(g_pointerPs);
  SafeRelease(g_pointerCb);
  SafeRelease(g_fitVs);
  SafeRelease(g_fitPs);
  SafeRelease(g_fitCb);
  SafeRelease(g_cb);
  SafeRelease(g_sampler);
  SafeRelease(g_blend);
  SafeRelease(g_raster);
  SafeRelease(g_depth);
  g_dev = nullptr;
}

void Draw(IDXGISwapChain* sc, ID3D11DeviceContext* ctx, ID3D11ShaderResourceView* const srv[2], unsigned frameW,
          unsigned frameH, const Rect& src, float open) {
  if (g_failed || !g_dev || !frameW || !frameH || src.w < 1 || src.h < 1 || !EnsureTarget(sc)) return;
  DXGI_SWAP_CHAIN_DESC sd;
  sc->GetDesc(&sd);
  const float vw = static_cast<float>(sd.BufferDesc.Width);
  const float vh = static_cast<float>(sd.BufferDesc.Height);
  if (vw < 16 || vh < 16) return;

  // Panel: as tall as fits comfortably, the shown part's aspect, centred; grows from 92% as it opens.
  const float aspect = src.w / src.h;
  float h = vh * 0.74f;
  float w = h * aspect;
  if (w > vw * 0.9f) {
    w = vw * 0.9f;
    h = w / aspect;
  }
  const float t = std::clamp(open, 0.0f, 1.08f);
  const float scale = 0.92f + 0.08f * t;
  w *= scale;
  h *= scale;
  const float opacity = std::clamp(open * 1.4f, 0.0f, 1.0f);

  Params p{};
  p.panel[0] = (vw - w) * 0.5f;
  p.panel[1] = (vh - h) * 0.5f;
  p.panel[2] = w;
  p.panel[3] = h;
  p.view[0] = vw;
  p.view[1] = vh;
  p.view[2] = h * 0.045f;  // corner radius
  p.view[3] = opacity;
  p.extra[0] = 0.38f;      // dim behind
  p.extra[1] = h * 0.09f;  // shadow reach
  p.extra[2] = 0.55f;      // shadow strength
  p.crop[0] = src.x / frameW;
  p.crop[1] = src.y / frameH;
  p.crop[2] = (src.x + src.w) / frameW;
  p.crop[3] = (src.y + src.h) / frameH;

  Backup b{};
  Save(ctx, b);

  D3D11_MAPPED_SUBRESOURCE m;
  if (SUCCEEDED(ctx->Map(g_cb, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
    memcpy(m.pData, &p, sizeof p);
    ctx->Unmap(g_cb, 0);
  }
  // Pass sRGB-encoded UI pixels straight through to an 8-bit UNORM target; let the hardware
  // convert when the target is sRGB or linear float.
  ID3D11ShaderResourceView* view = (IsSrgb(g_rtvFormat) || IsLinearFloat(g_rtvFormat)) ? srv[1] : srv[0];
  const D3D11_VIEWPORT vp{0, 0, vw, vh, 0, 1};
  const float blendFactor[4] = {0, 0, 0, 0};
  ctx->OMSetRenderTargets(1, &g_rtv, nullptr);
  ctx->OMSetBlendState(g_blend, blendFactor, 0xffffffff);
  ctx->OMSetDepthStencilState(g_depth, 0);
  ctx->RSSetState(g_raster);
  ctx->RSSetViewports(1, &vp);
  ctx->IASetInputLayout(nullptr);
  ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  ctx->IASetVertexBuffers(0, 0, nullptr, nullptr, nullptr);
  ctx->VSSetShader(g_vs, nullptr, 0);
  ctx->VSSetConstantBuffers(0, 1, &g_cb);
  ctx->GSSetShader(nullptr, nullptr, 0);
  ctx->HSSetShader(nullptr, nullptr, 0);
  ctx->DSSetShader(nullptr, nullptr, 0);
  ctx->PSSetShader(g_ps, nullptr, 0);
  ctx->PSSetConstantBuffers(0, 1, &g_cb);
  ctx->PSSetShaderResources(0, 1, &view);
  ctx->PSSetSamplers(0, 1, &g_sampler);
  ctx->Draw(3, 0);

  Restore(ctx, b);
}

void DrawPointer(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* target, ID3D11ShaderResourceView* base,
                 const D3D11_BOX& box, const pointer::Shape& s, float ringWidth) {
  if (!g_pointerVs || !g_pointerPs || !g_pointerCb || !target || !base || box.right <= box.left ||
      box.bottom <= box.top) {
    return;
  }
  PointerParams p{{s.cx, s.cy, s.hw, s.hh}, {s.radius, s.alpha, ringWidth, s.ring}};

  Backup b{};
  Save(ctx, b);
  D3D11_MAPPED_SUBRESOURCE m;
  if (SUCCEEDED(ctx->Map(g_pointerCb, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
    memcpy(m.pData, &p, sizeof p);
    ctx->Unmap(g_pointerCb, 0);
  }
  // The viewport is the box; SV_Position still arrives in whole-target pixels.
  const D3D11_VIEWPORT vp{static_cast<float>(box.left), static_cast<float>(box.top),
                          static_cast<float>(box.right - box.left), static_cast<float>(box.bottom - box.top), 0, 1};
  const float blendFactor[4] = {0, 0, 0, 0};
  ID3D11ShaderResourceView* none = nullptr;
  ctx->PSSetShaderResources(0, 1, &none);  // base must not stay bound anywhere as we write
  ctx->OMSetRenderTargets(1, &target, nullptr);
  ctx->OMSetBlendState(nullptr, blendFactor, 0xffffffff);
  ctx->OMSetDepthStencilState(g_depth, 0);
  ctx->RSSetState(g_raster);
  ctx->RSSetViewports(1, &vp);
  ctx->IASetInputLayout(nullptr);
  ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  ctx->IASetVertexBuffers(0, 0, nullptr, nullptr, nullptr);
  ctx->VSSetShader(g_pointerVs, nullptr, 0);
  ctx->GSSetShader(nullptr, nullptr, 0);
  ctx->HSSetShader(nullptr, nullptr, 0);
  ctx->DSSetShader(nullptr, nullptr, 0);
  ctx->PSSetShader(g_pointerPs, nullptr, 0);
  ctx->PSSetConstantBuffers(0, 1, &g_pointerCb);
  ctx->PSSetShaderResources(0, 1, &base);
  ctx->Draw(3, 0);
  Restore(ctx, b);
}

void DrawFit(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* target, unsigned targetW, unsigned targetH, bool srgbTarget,
             ID3D11ShaderResourceView* const srv[2], unsigned frameW, unsigned frameH, const Rect& src, float panelAspect,
             float radius, float panelRadius, const float fill[4], float glow, float opacity) {
  if (g_failed || !g_fitVs || !g_fitPs || !g_fitCb || !target || !targetW || !targetH || !frameW || !frameH || src.w < 1 ||
      src.h < 1) {
    return;
  }
  // The texture is seen stretched over the panel: a frame `rw` x `rh` of it shows at the frame's
  // own proportions when rw / rh = frame aspect × texture aspect / panel aspect.
  const float tw = static_cast<float>(targetW), th = static_cast<float>(targetH);
  const float want = (src.w / src.h) * (tw / th) / panelAspect;
  float rw = tw, rh = tw / want;
  if (rh > th) {
    rh = th;
    rw = th * want;
  }
  const float l = std::floor((tw - rw) * 0.5f), t = std::floor((th - rh) * 0.5f);
  // The fill is meant as seen: in a target that encodes sRGB it is given linear.
  auto lin = [&](float v) { return srgbTarget ? std::pow(v, 2.2f) : v; };
  const float u0 = src.x / frameW, v0 = src.y / frameH, u1 = (src.x + src.w) / frameW, v1 = (src.y + src.h) / frameH;
  FitParams p{{l, t, l + rw, t + rh},
              {0.25f / rw * (u1 - u0), 0.25f / rh * (v1 - v0), radius, std::clamp(opacity, 0.0f, 1.0f)},
              {lin(fill[0]), lin(fill[1]), lin(fill[2]), fill[3]},
              {tw, th, panelRadius, std::clamp(glow, 0.0f, 1.0f)},
              {u0, v0, u1, v1}};

  Backup b{};
  Save(ctx, b);
  D3D11_MAPPED_SUBRESOURCE m;
  if (SUCCEEDED(ctx->Map(g_fitCb, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
    memcpy(m.pData, &p, sizeof p);
    ctx->Unmap(g_fitCb, 0);
  }
  ID3D11ShaderResourceView* view = srgbTarget ? srv[1] : srv[0];
  const D3D11_VIEWPORT vp{0, 0, tw, th, 0, 1};
  const float blendFactor[4] = {0, 0, 0, 0};
  ctx->OMSetRenderTargets(1, &target, nullptr);
  ctx->OMSetBlendState(nullptr, blendFactor, 0xffffffff);  // the whole texture is written
  ctx->OMSetDepthStencilState(g_depth, 0);
  ctx->RSSetState(g_raster);
  ctx->RSSetViewports(1, &vp);
  ctx->IASetInputLayout(nullptr);
  ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  ctx->IASetVertexBuffers(0, 0, nullptr, nullptr, nullptr);
  ctx->VSSetShader(g_fitVs, nullptr, 0);
  ctx->GSSetShader(nullptr, nullptr, 0);
  ctx->HSSetShader(nullptr, nullptr, 0);
  ctx->DSSetShader(nullptr, nullptr, 0);
  ctx->PSSetShader(g_fitPs, nullptr, 0);
  ctx->PSSetConstantBuffers(0, 1, &g_fitCb);
  ctx->PSSetShaderResources(0, 1, &view);
  ctx->PSSetSamplers(0, 1, &g_sampler);
  ctx->Draw(3, 0);
  Restore(ctx, b);
}

}  // namespace tp::overlay
