// Stand-in for the TruckPlay host while testing in the game: connects to the plugin's pipe, prints what
// it hears, and streams a test pattern (grid, moving bar, pointer crosshair) into the in-cab screen.

#include <windows.h>

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

namespace {

constexpr uint64_t kMaxW = 2048, kMaxH = 1600, kBuf = kMaxW * kMaxH * 4, kHeader = 128;
struct BufInfo { uint32_t width, height, stride, dx, dy, dw, dh, pad; };
struct Header { uint32_t magic, version, front, flags; uint64_t seq, hostPid; BufInfo buf[2]; uint8_t reserved[32]; };

std::atomic<uint32_t> g_w{0}, g_h{0};
std::atomic<float> g_px{0.5f}, g_py{0.5f};
std::atomic<bool> g_inside{false}, g_down{false};
std::atomic<bool> g_quit{false};

double Num(const std::string& s, const char* key, double fallback = 0) {
  const std::string k = std::string("\"") + key + "\":";
  const size_t at = s.find(k);
  return at == std::string::npos ? fallback : atof(s.c_str() + at + k.size());
}
std::string Str(const std::string& s, const char* key) {
  const std::string k = std::string("\"") + key + "\":\"";
  const size_t at = s.find(k);
  if (at == std::string::npos) return {};
  const size_t end = s.find('"', at + k.size());
  return s.substr(at + k.size(), end - at - k.size());
}

void Handle(const std::string& line) {
  const std::string t = Str(line, "t");
  static DWORD lastTel = 0;
  if (t == "tel") {
    if (GetTickCount() - lastTel < 2000) return;
    lastTel = GetTickCount();
    const size_t truck = line.find("\"truck\":");
    const std::string tr = truck == std::string::npos ? line : line.substr(truck);
    printf("tel  paused=%s speed=%.1f km/h rpm=%.0f gear=%.0f fuel=%.0f L  x=%.1f z=%.1f  job=%s\n",
           line.find("\"paused\":true") != std::string::npos ? "yes" : "no", Num(tr, "speed") * 3.6, Num(tr, "rpm"),
           Num(tr, "gear"), Num(tr, "fuel"), Num(tr, "x"), Num(tr, "z"), Str(line, "cargo").c_str());
  } else if (t == "screen") {
    g_w = static_cast<uint32_t>(Num(line, "w"));
    g_h = static_cast<uint32_t>(Num(line, "h"));
    printf("screen %s\n", line.c_str());
  } else if (t == "ptr") {
    const std::string act = Str(line, "act");
    g_px = static_cast<float>(Num(line, "x", 0.5));
    g_py = static_cast<float>(Num(line, "y", 0.5));
    if (act == "enter") g_inside = true;
    if (act == "leave") g_inside = false;
    if (act == "down") g_down = true;
    if (act == "up") g_down = false;
    if (act != "move") printf("ptr  %s\n", line.c_str());
  } else {
    printf("%s\n", line.c_str());
  }
}

void PipeLoop() {
  while (!g_quit) {
    HANDLE h = CreateFileW(L"\\\\.\\pipe\\tirplay", GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
      Sleep(1000);
      continue;
    }
    printf("-- connected to plugin\n");
    const char hello[] = "{\"t\":\"hello\",\"host\":\"testhost\"}\n";
    DWORD wrote;
    WriteFile(h, hello, sizeof hello - 1, &wrote, nullptr);
    std::string inbox;
    char buf[65536];
    DWORD got;
    while (!g_quit && ReadFile(h, buf, sizeof buf, &got, nullptr) && got) {
      inbox.append(buf, got);
      size_t nl;
      while ((nl = inbox.find('\n')) != std::string::npos) {
        Handle(inbox.substr(0, nl));
        inbox.erase(0, nl + 1);
      }
    }
    CloseHandle(h);
    printf("-- disconnected\n");
  }
}

// 5x7 digits for the calibration labels.
const char* kDigits[10][7] = {
    {".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."}, {"..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."},
    {".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"}, {"####.", "....#", "....#", ".###.", "....#", "....#", "####."},
    {"...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."}, {"#####", "#....", "####.", "....#", "....#", "#...#", ".###."},
    {"..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."}, {"#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."},
    {".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."}, {".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."}};

void Rect(uint8_t* px, uint32_t w, uint32_t h, int x0, int y0, int rw, int rh, uint32_t c) {
  for (int y = y0; y < y0 + rh; ++y)
    for (int x = x0; x < x0 + rw; ++x)
      if (x >= 0 && y >= 0 && x < static_cast<int>(w) && y < static_cast<int>(h))
        reinterpret_cast<uint32_t*>(px)[static_cast<size_t>(y) * w + x] = c;
}

void Number(uint8_t* px, uint32_t w, uint32_t h, int x, int y, int value, int s, uint32_t c) {
  char text[8];
  snprintf(text, sizeof text, "%d", value);
  for (const char* p = text; *p; ++p, x += 6 * s)
    for (int ry = 0; ry < 7; ++ry)
      for (int rx = 0; rx < 5; ++rx)
        if (kDigits[*p - '0'][ry][rx] == '#') Rect(px, w, h, x + rx * s, y + ry * s, s, s, c);
}

void Pattern(uint8_t* px, uint32_t w, uint32_t h, double t) {
  for (uint32_t y = 0; y < h; ++y) {
    uint32_t* row = reinterpret_cast<uint32_t*>(px + static_cast<size_t>(y) * w * 4);
    for (uint32_t x = 0; x < w; ++x) {
      const uint8_t r = static_cast<uint8_t>(30 + 90 * x / w);
      const uint8_t g = static_cast<uint8_t>(30 + 80 * y / h);
      row[x] = 0xff000000u | (r << 16) | (g << 8) | 70u;
    }
  }
  // Calibration grid: a line every 1/16, labelled in percent every 1/8 (x along the middle row, y along the middle column).
  const int s = static_cast<int>(w / 220 > 2 ? w / 220 : 2);
  for (int i = 0; i <= 16; ++i) {
    const int gx = static_cast<int>(static_cast<double>(i) / 16 * (w - 1));
    const int gy = static_cast<int>(static_cast<double>(i) / 16 * (h - 1));
    const bool major = i % 2 == 0;
    const uint32_t col = major ? 0xffffc400 : 0xff5a5a64;
    Rect(px, w, h, gx - (major ? 2 : 1), 0, major ? 4 : 2, static_cast<int>(h), col);
    Rect(px, w, h, 0, gy - (major ? 2 : 1), static_cast<int>(w), major ? 4 : 2, col);
    if (major) {
      Number(px, w, h, gx + 6, static_cast<int>(h / 2) + 6, i * 100 / 16, s, 0xffffffff);
      Number(px, w, h, static_cast<int>(w / 2) + 6, gy + 6, i * 100 / 16, s, 0xff78dcff);
    }
  }
  const int m = static_cast<int>(w / 20);
  Rect(px, w, h, 0, 0, m, m, 0xffff3b30);                                       // top-left red
  Rect(px, w, h, static_cast<int>(w) - m, 0, m, m, 0xff34c759);                 // top-right green
  Rect(px, w, h, 0, static_cast<int>(h) - m, m, m, 0xff007aff);                 // bottom-left blue
  Rect(px, w, h, static_cast<int>(w) - m, static_cast<int>(h) - m, m, m, 0xffffffff);  // bottom-right white
  // Moving bar proves frames are live.
  const uint32_t bx = static_cast<uint32_t>((0.5 + 0.5 * std::sin(t * 1.5)) * (w - 40));
  for (uint32_t y = h - 60; y < h - 20; ++y)
    for (uint32_t x = bx; x < bx + 40; ++x) reinterpret_cast<uint32_t*>(px)[static_cast<size_t>(y) * w + x] = 0xff34c759;
  // Pointer crosshair.
  if (g_inside) {
    const int cx = static_cast<int>(g_px * (w - 1)), cy = static_cast<int>(g_py * (h - 1));
    const uint32_t col = g_down ? 0xffff3b30 : 0xffffffff;
    for (int d = -24; d <= 24; ++d) {
      for (int k = -2; k <= 2; ++k) {
        if (cx + d >= 0 && cx + d < static_cast<int>(w) && cy + k >= 0 && cy + k < static_cast<int>(h))
          reinterpret_cast<uint32_t*>(px)[static_cast<size_t>(cy + k) * w + cx + d] = col;
        if (cy + d >= 0 && cy + d < static_cast<int>(h) && cx + k >= 0 && cx + k < static_cast<int>(w))
          reinterpret_cast<uint32_t*>(px)[static_cast<size_t>(cy + d) * w + cx + k] = col;
      }
    }
  }
}

}  // namespace

int main() {
  setvbuf(stdout, nullptr, _IONBF, 0);  // output usually goes to a log file
  constexpr uint64_t total = kHeader + 2 * kBuf;
  HANDLE map = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, static_cast<DWORD>(total >> 32),
                                  static_cast<DWORD>(total), L"Local\\TruckPlayFrames");
  auto* base = static_cast<uint8_t*>(MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, 0));
  if (!base) {
    printf("shared memory failed\n");
    return 1;
  }
  auto* hdr = reinterpret_cast<Header*>(base);
  hdr->magic = 0x31465054;
  hdr->version = 1;
  hdr->hostPid = GetCurrentProcessId();
  hdr->flags = 1;

  std::thread pipe(PipeLoop);
  printf("testhost: waiting for the game (Ctrl+C to quit)\n");
  const DWORD start = GetTickCount();
  uint32_t back = 1;
  for (;;) {
    const uint32_t w = g_w, h = g_h;
    if (w && h && w <= kMaxW && h <= kMaxH) {
      uint8_t* px = base + kHeader + back * kBuf;
      Pattern(px, w, h, (GetTickCount() - start) / 1000.0);
      hdr->buf[back] = {w, h, w * 4, 0, 0, w, h, 0};
      hdr->front = back;
      MemoryBarrier();
      ++hdr->seq;
      back ^= 1;
    }
    Sleep(33);
  }
}
