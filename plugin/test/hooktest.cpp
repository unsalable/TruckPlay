// Exercises truckplay.dll the way the game will: the device exists before the plugin loads, the
// "game" creates a 1282-wide marker texture, a "host" publishes frames through shared memory.
// Exit code 0 = all checks passed.

#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

namespace {

constexpr UINT kW = 1282, kH = 722;
constexpr uint64_t kMaxW = 2048, kMaxH = 1600, kBuf = kMaxW * kMaxH * 4, kHeader = 128;

struct BufInfo { uint32_t width, height, stride, dx, dy, dw, dh, pad; };
struct Header { uint32_t magic, version, front, flags; uint64_t seq, hostPid; BufInfo buf[2]; uint8_t reserved[32]; };

int g_failures = 0;
void Check(bool ok, const char* what) {
  printf("%s  %s\n", ok ? "PASS" : "FAIL", what);
  if (!ok) ++g_failures;
}

uint32_t ReadPixel(ID3D11Device* dev, ID3D11DeviceContext* ctx, ID3D11Texture2D* tex, UINT x, UINT y) {
  D3D11_TEXTURE2D_DESC d;
  tex->GetDesc(&d);
  d.Usage = D3D11_USAGE_STAGING;
  d.BindFlags = 0;
  d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  d.MiscFlags = 0;
  d.MipLevels = 1;
  ID3D11Texture2D* staging = nullptr;
  if (FAILED(dev->CreateTexture2D(&d, nullptr, &staging))) return 0xdeadbeef;
  ctx->CopySubresourceRegion(staging, 0, 0, 0, 0, tex, 0, nullptr);
  D3D11_MAPPED_SUBRESOURCE m;
  uint32_t px = 0xdeadbeef;
  if (SUCCEEDED(ctx->Map(staging, 0, D3D11_MAP_READ, 0, &m))) {
    px = *reinterpret_cast<const uint32_t*>(static_cast<const uint8_t*>(m.pData) + y * m.RowPitch + x * 4);
    ctx->Unmap(staging, 0);
  }
  staging->Release();
  return px;
}

void Fill(uint8_t* buf, UINT x0, UINT y0, UINT w, UINT h, uint32_t bgra) {
  for (UINT y = y0; y < y0 + h; ++y)
    for (UINT x = x0; x < x0 + w; ++x) memcpy(buf + (static_cast<size_t>(y) * kW + x) * 4, &bgra, 4);
}

}  // namespace

int main() {
  WNDCLASSEXW wc{sizeof wc};
  wc.lpfnWndProc = DefWindowProcW;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"TruckPlayHookTest";
  RegisterClassExW(&wc);
  HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"TruckPlay hook test", WS_OVERLAPPEDWINDOW, 100, 100, 1280, 720,
                              nullptr, nullptr, wc.hInstance, nullptr);

  // SEQUENTIAL keeps the back buffer after Present, so the big view can be read back.
  DXGI_SWAP_CHAIN_DESC sd{};
  sd.BufferCount = 1;
  sd.BufferDesc.Width = 1280;
  sd.BufferDesc.Height = 720;
  sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  sd.OutputWindow = hwnd;
  sd.SampleDesc.Count = 1;
  sd.Windowed = TRUE;
  sd.SwapEffect = DXGI_SWAP_EFFECT_SEQUENTIAL;
  IDXGISwapChain* sc = nullptr;
  ID3D11Device* dev = nullptr;
  ID3D11DeviceContext* ctx = nullptr;
  if (FAILED(D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION,
                                           &sd, &sc, &dev, nullptr, &ctx))) {
    printf("FAIL  device creation\n");
    return 2;
  }

  // Own shared memory and pipe names, so a running game (and its host) stays out of the test.
  SetEnvironmentVariableW(L"TRUCKPLAY_SHM", L"TruckPlayFramesTest");
  SetEnvironmentVariableW(L"TRUCKPLAY_PIPE", L"tirplay-test");

  // Plugin loads after the device exists, like in the game.
  HMODULE dll = LoadLibraryW(L"truckplay.dll");
  Check(dll != nullptr, "truckplay.dll loads");
  if (!dll) return 3;
  auto start = reinterpret_cast<int (*)()>(GetProcAddress(dll, "tirplay_selftest_start"));
  auto stop = reinterpret_cast<void (*)()>(GetProcAddress(dll, "tirplay_selftest_stop"));
  auto big = reinterpret_cast<void (*)(int)>(GetProcAddress(dll, "tirplay_selftest_big"));
  auto message = reinterpret_cast<void (*)(const char*)>(GetProcAddress(dll, "tirplay_selftest_message"));
  auto pointer = reinterpret_cast<void (*)(int, float, float, int)>(GetProcAddress(dll, "tirplay_selftest_pointer"));
  Check(message && pointer, "pointer test hooks exported");
  if (!message || !pointer) return 4;
  Check(GetProcAddress(dll, "scs_telemetry_init") && GetProcAddress(dll, "scs_telemetry_shutdown"), "SDK entry points exported");
  Check(start && start() == 1, "self-test start");

  // "Game" creates the marker as an immutable texture with initial data.
  std::vector<uint32_t> gray(static_cast<size_t>(kW) * kH, 0xff808080);
  D3D11_TEXTURE2D_DESC td{kW, kH, 1, 1, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, {1, 0}, D3D11_USAGE_IMMUTABLE,
                          D3D11_BIND_SHADER_RESOURCE, 0, 0};
  D3D11_SUBRESOURCE_DATA init{gray.data(), kW * 4, 0};
  ID3D11Texture2D* marker = nullptr;
  Check(SUCCEEDED(dev->CreateTexture2D(&td, &init, &marker)) && marker, "marker texture created through the hook");
  D3D11_TEXTURE2D_DESC got{};
  marker->GetDesc(&got);
  Check(got.Usage == D3D11_USAGE_DEFAULT, "marker was turned into a DEFAULT (writable) texture");

  // "Host" publishes a magenta frame.
  HANDLE map = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, L"Local\\TruckPlayFramesTest");
  Check(map != nullptr, "shared memory exists");
  auto* base = static_cast<uint8_t*>(MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, 0));
  auto* hdr = reinterpret_cast<Header*>(base);
  uint8_t* buf0 = base + kHeader;
  uint8_t* buf1 = base + kHeader + kBuf;
  Fill(buf0, 0, 0, kW, kH, 0xffff00ff);  // BGRA bytes FF 00 FF FF = magenta
  hdr->buf[0] = {kW, kH, kW * 4, 0, 0, kW, kH, 0};
  hdr->front = 0;
  hdr->flags = 1;
  hdr->seq = 1;

  auto present = [&](int n) {
    for (int i = 0; i < n; ++i) {
      MSG msg;
      while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) DispatchMessageW(&msg);
      sc->Present(0, 0);
      Sleep(5);
    }
  };
  present(3);
  Check(ReadPixel(dev, ctx, marker, 5, 5) == 0xffff00ff, "frame reached the marker texture");

  // Next frame: green square, published with a dirty rect only.
  memcpy(buf1, buf0, static_cast<size_t>(kW) * kH * 4);
  Fill(buf1, 100, 100, 20, 20, 0xff00ff00);
  hdr->buf[1] = {kW, kH, kW * 4, 100, 100, 20, 20, 0};
  hdr->front = 1;
  hdr->seq = 2;
  present(2);
  Check(ReadPixel(dev, ctx, marker, 110, 110) == 0xff00ff00, "dirty rect uploaded");
  Check(ReadPixel(dev, ctx, marker, 5, 5) == 0xffff00ff, "rest of the frame kept");

  // Pointer drawn by the plugin: the host names the UI area, the UI names one button (a plate
  // target at 600,300 40x40). x/y are 0–1 across the UI area.
  message("{\"t\":\"cfg\",\"fx\":0,\"fy\":0,\"fw\":1282,\"fh\":722}");
  message("{\"t\":\"targets\",\"d\":28,\"pad\":7,\"lean\":0.12,\"list\":[600,300,40,40,12,1]}");
  const float discX = 320.0f / (kW - 1), discY = 360.0f / (kH - 1);
  pointer(1, discX, discY, 0);
  present(60);
  const uint32_t disc = ReadPixel(dev, ctx, marker, 320, 360);
  printf("info  pointer disc pixel=0x%08x\n", disc);
  Check(disc != 0xffff00ff && ((disc >> 8) & 0xff) > 0x30, "pointer disc drawn at the mouse position (lightened over dark)");
  Check(ReadPixel(dev, ctx, marker, 360, 360) == 0xffff00ff, "pointer leaves the rest of the screen alone");

  pointer(1, 620.0f / (kW - 1), 320.0f / (kH - 1), 0);
  present(60);
  const uint32_t plate = ReadPixel(dev, ctx, marker, 596, 320);  // inside the plate, outside the button
  printf("info  pointer plate pixel=0x%08x\n", plate);
  Check(plate != 0xffff00ff, "hovering the button morphs the pointer into a plate around it");
  Check(ReadPixel(dev, ctx, marker, 320, 360) == 0xffff00ff, "old pointer position restored");

  // An app icon (lift target, kind 2): a white focus ring around it; the icon itself stays clear.
  message("{\"t\":\"targets\",\"d\":28,\"pad\":7,\"lean\":0.12,\"list\":[600,300,40,40,12,1,800,300,60,60,13,2]}");
  pointer(1, 830.0f / (kW - 1), 330.0f / (kH - 1), 0);
  present(60);
  const uint32_t ringPx = ReadPixel(dev, ctx, marker, 797, 330);
  printf("info  focus ring pixel=0x%08x\n", ringPx);
  Check(((ringPx >> 8) & 0xff) > 0xc0, "an app icon gets a bright focus ring around it");
  Check(ReadPixel(dev, ctx, marker, 830, 330) == 0xffff00ff, "the icon inside the ring is left untouched");

  pointer(0, 830.0f / (kW - 1), 330.0f / (kH - 1), 0);
  present(60);
  Check(ReadPixel(dev, ctx, marker, 620, 320) == 0xffff00ff && ReadPixel(dev, ctx, marker, 797, 330) == 0xffff00ff,
        "pointer fades out when the hold key is released");

  // Big view: once the spring settles, the frame covers the middle of the back buffer and the rest is dimmed.
  big(1);
  present(150);
  ID3D11Texture2D* back = nullptr;
  sc->GetBuffer(0, IID_PPV_ARGS(&back));
  ID3D11RenderTargetView* rtv = nullptr;
  dev->CreateRenderTargetView(back, nullptr, &rtv);
  const float clear[4] = {0.0f, 0.0f, 1.0f, 1.0f};
  ctx->ClearRenderTargetView(rtv, clear);
  sc->Present(0, 0);  // the hook draws the panel on top of the blue clear
  const uint32_t center = ReadPixel(dev, ctx, back, 640, 360);
  const uint32_t corner = ReadPixel(dev, ctx, back, 3, 3);
  printf("info  back buffer centre=0x%08x corner=0x%08x\n", center, corner);
  Check(center == 0xffff00ff, "big view shows the frame in the middle");
  const uint32_t cornerBlue = (corner >> 16) & 0xff;
  Check(cornerBlue > 60 && cornerBlue < 250 && (corner & 0xff) < 10, "big view dims the game around it");
  rtv->Release();
  back->Release();
  big(0);
  present(120);

  stop();
  FreeLibrary(dll);
  UnmapViewOfFile(base);
  CloseHandle(map);
  marker->Release();
  ctx->Release();
  dev->Release();
  sc->Release();
  DestroyWindow(hwnd);
  printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
  return g_failures ? 1 : 0;
}
