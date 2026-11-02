#define DIRECTINPUT_VERSION 0x0800
#include "input.h"

#include <dinput.h>

#include <atomic>
#include <cmath>
#include <cwctype>
#include <mutex>
#include <unordered_map>
#include <vector>

#include "json.h"
#include "log.h"
#include "pipe.h"
#include "vhook.h"

namespace tp::input {
namespace {

// ---------------- configuration & state ----------------

std::atomic<HWND> g_hwnd{nullptr};
std::atomic<int> g_holdVk{'G'};
std::atomic<int> g_zoomVk{'Y'};
std::atomic<float> g_sens{1.0f};
std::atomic<float> g_aspect{16.0f / 9.0f};
std::atomic<bool> g_typing{false};
std::atomic<bool> g_big{false};
std::atomic<bool> g_holding{false};
std::atomic<bool> g_forced{false};
std::atomic<uint64_t> g_lastRawMouse{0};

// Pointer, written from whichever thread delivers mouse input, read on the render thread.
std::mutex g_ptrMu;
float g_x = 0.5f, g_y = 0.5f;
bool g_left = false, g_right = false, g_moved = false;
int g_wheel = 0;

// Render-thread state.
bool g_wasInteracting = false, g_zoomWas = false, g_escWas = false;
// The game's pause menu, as Esc toggles it. In a convoy the game never pauses, so the SDK's pause
// event never comes: Esc is the only sign. The UI also takes driving as a sign the menu is gone.
bool g_menu = false;
float g_bigPos = 0, g_bigVel = 0;
float g_rawCheckTimer = 0;

std::atomic<uint64_t> g_wmInput{0}, g_wmInputMouse{0}, g_wmInputKbd{0}, g_wmMouse{0}, g_wmKey{0}, g_wmChar{0};
std::atomic<uint64_t> g_diMouseState{0}, g_diMouseData{0}, g_diKbdState{0}, g_diKbdData{0}, g_rawBufCalls{0};

struct Subclass {
  HWND hwnd;
  WNDPROC original;
};
std::mutex g_subMu;
std::vector<Subclass> g_subclassed;

bool IsOurKey(int vk) { return vk == g_holdVk || vk == g_zoomVk; }

void SendPointer(const char* act, float x, float y, int button = -1, int wheel = 0) {
  JsonWriter w;
  w.beginObject().str("t", "ptr").str("act", act).num("x", x, 5).num("y", y, 5);
  if (button >= 0) w.integer("b", button);
  if (wheel) w.integer("dy", wheel);
  w.endObject();
  pipe::Send(w.text());
}

void Move(long dx, long dy) {
  constexpr float kCountsAcross = 1100.0f;  // mouse counts to sweep the screen width at sensitivity 1
  const float s = g_sens;
  std::lock_guard lock(g_ptrMu);
  g_x = std::fmin(1.0f, std::fmax(0.0f, g_x + static_cast<float>(dx) * s / kCountsAcross));
  g_y = std::fmin(1.0f, std::fmax(0.0f, g_y + static_cast<float>(dy) * s * g_aspect / kCountsAcross));
  g_moved = true;
}

void Button(int button, bool down) {
  float x, y;
  {
    std::lock_guard lock(g_ptrMu);
    bool& state = button == 0 ? g_left : g_right;
    if (state == down) return;
    state = down;
    x = g_x;
    y = g_y;
  }
  SendPointer(down ? "down" : "up", x, y, button);
}

void Wheel(int delta) {
  std::lock_guard lock(g_ptrMu);
  g_wheel += delta;
}

bool RawMouseRecent() { return GetTickCount64() - g_lastRawMouse < 500; }

void SendKey(const char* act, int vk) {
  JsonWriter w;
  w.beginObject().str("t", "key").str("act", act).integer("vk", vk).endObject();
  pipe::Send(w.text());
}

void SendChar(wchar_t ch) {
  char utf8[8];
  const int n = WideCharToMultiByte(CP_UTF8, 0, &ch, 1, utf8, sizeof utf8, nullptr, nullptr);
  if (n <= 0) return;
  JsonWriter w;
  w.beginObject().str("t", "key").str("act", "char").str("ch", std::string(utf8, n)).endObject();
  pipe::Send(w.text());
}

// Keys a text field cares about besides characters.
bool IsEditingKey(int vk) {
  switch (vk) {
    case VK_BACK: case VK_RETURN: case VK_ESCAPE: case VK_TAB: case VK_DELETE: case VK_LEFT: case VK_RIGHT:
    case VK_UP: case VK_DOWN: case VK_HOME: case VK_END:
      return true;
    default:
      return false;
  }
}

void OnRawMouse(const RAWMOUSE& m) {
  g_lastRawMouse = GetTickCount64();
  if (!(m.usFlags & MOUSE_MOVE_ABSOLUTE) && (m.lLastX || m.lLastY)) Move(m.lLastX, m.lLastY);
  if (m.usButtonFlags & RI_MOUSE_LEFT_BUTTON_DOWN) Button(0, true);
  if (m.usButtonFlags & RI_MOUSE_LEFT_BUTTON_UP) Button(0, false);
  if (m.usButtonFlags & RI_MOUSE_RIGHT_BUTTON_DOWN) Button(2, true);
  if (m.usButtonFlags & RI_MOUSE_RIGHT_BUTTON_UP) Button(2, false);
  if (m.usButtonFlags & RI_MOUSE_WHEEL) Wheel(static_cast<short>(m.usButtonData));
}

// Raw keyboard while typing: the game may suppress legacy WM_CHAR, so translate here.
void OnRawKey(const RAWKEYBOARD& k) {
  const bool down = !(k.Flags & RI_KEY_BREAK);
  if (!down) return;
  if (IsEditingKey(k.VKey)) {
    SendKey("down", k.VKey);
    return;
  }
  BYTE state[256];
  if (!GetKeyboardState(state)) return;
  wchar_t buf[4];
  const int n = ToUnicodeEx(k.VKey, k.MakeCode, state, buf, 4, 0, GetKeyboardLayout(0));
  for (int i = 0; i < n; ++i) {
    if (buf[i] >= 0x20) SendChar(buf[i]);
  }
}

// ---------------- window procedure ----------------

WNDPROC OriginalProc(HWND h) {
  std::lock_guard lock(g_subMu);
  for (const Subclass& s : g_subclassed)
    if (s.hwnd == h) return s.original;
  return nullptr;
}

std::atomic<bool> g_wmCharSeen{false};

LRESULT CALLBACK Proc(HWND h, UINT m, WPARAM w, LPARAM l) {
  const bool interacting = Interacting();
  const bool typing = g_typing;
  switch (m) {
    case WM_INPUT: {
      ++g_wmInput;
      RAWINPUT ri;
      UINT size = sizeof ri;
      if (GetRawInputData(reinterpret_cast<HRAWINPUT>(l), RID_INPUT, &ri, &size, sizeof(RAWINPUTHEADER)) == static_cast<UINT>(-1))
        break;
      if (ri.header.dwType == RIM_TYPEMOUSE) {
        ++g_wmInputMouse;
        if (interacting) {
          OnRawMouse(ri.data.mouse);
          return DefWindowProcW(h, m, w, l);  // swallow, but let the system clean up
        }
      } else if (ri.header.dwType == RIM_TYPEKEYBOARD) {
        ++g_wmInputKbd;
        const int vk = ri.data.keyboard.VKey;
        if (typing) {
          if (!g_wmCharSeen) OnRawKey(ri.data.keyboard);
          return DefWindowProcW(h, m, w, l);
        }
        if (IsOurKey(vk) || (g_big && vk == VK_ESCAPE)) return DefWindowProcW(h, m, w, l);
      }
      break;
    }
    case WM_MOUSEMOVE: case WM_LBUTTONDOWN: case WM_LBUTTONUP: case WM_LBUTTONDBLCLK: case WM_RBUTTONDOWN:
    case WM_RBUTTONUP: case WM_MBUTTONDOWN: case WM_MBUTTONUP: case WM_MOUSEWHEEL: case WM_MOUSEHWHEEL:
      ++g_wmMouse;
      if (interacting) {
        if (!RawMouseRecent()) {
          if (m == WM_LBUTTONDOWN || m == WM_LBUTTONDBLCLK) Button(0, true);
          else if (m == WM_LBUTTONUP) Button(0, false);
          else if (m == WM_RBUTTONDOWN) Button(2, true);
          else if (m == WM_RBUTTONUP) Button(2, false);
          else if (m == WM_MOUSEWHEEL) Wheel(GET_WHEEL_DELTA_WPARAM(w));
        }
        return 0;
      }
      break;
    case WM_KEYDOWN: case WM_SYSKEYDOWN: case WM_KEYUP: case WM_SYSKEYUP:
      ++g_wmKey;
      if (typing) {
        if ((m == WM_KEYDOWN || m == WM_SYSKEYDOWN) && IsEditingKey(static_cast<int>(w))) SendKey("down", static_cast<int>(w));
        return 0;
      }
      if (IsOurKey(static_cast<int>(w))) return 0;
      if (g_big && w == VK_ESCAPE) return 0;
      break;
    case WM_CHAR: case WM_SYSCHAR:
      ++g_wmChar;
      if (typing) {
        g_wmCharSeen = true;
        if (w >= 0x20) SendChar(static_cast<wchar_t>(w));
        return 0;
      }
      if (IsOurKey(static_cast<int>(towupper(static_cast<wint_t>(w))))) return 0;
      break;
    case WM_KILLFOCUS:
      if (typing) {
        g_typing = false;
        SendKey("blur", 0);
      }
      break;
    default:
      break;
  }
  WNDPROC original = OriginalProc(h);
  return original ? CallWindowProcW(original, h, m, w, l) : DefWindowProcW(h, m, w, l);
}

void SubclassWindow(HWND hwnd) {
  if (!hwnd) return;
  {
    std::lock_guard lock(g_subMu);
    for (const Subclass& s : g_subclassed)
      if (s.hwnd == hwnd) return;
  }
  const auto original = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&Proc)));
  if (!original) {
    TPLOG("input: subclass %p failed (%lu)", hwnd, GetLastError());
    return;
  }
  std::lock_guard lock(g_subMu);
  g_subclassed.push_back({hwnd, original});
  TPLOG("input: window %p subclassed", hwnd);
}

// The game may route raw input to a hidden window; follow the registrations.
void FollowRawInputTargets(bool log) {
  UINT count = 0;
  GetRegisteredRawInputDevices(nullptr, &count, sizeof(RAWINPUTDEVICE));
  if (!count) return;
  std::vector<RAWINPUTDEVICE> devs(count);
  if (GetRegisteredRawInputDevices(devs.data(), &count, sizeof(RAWINPUTDEVICE)) == static_cast<UINT>(-1)) return;
  for (UINT i = 0; i < count; ++i) {
    const RAWINPUTDEVICE& d = devs[i];
    if (log) TPLOG("input: raw device page=%u usage=%u flags=0x%lx target=%p", d.usUsagePage, d.usUsage, d.dwFlags, d.hwndTarget);
    if (d.usUsagePage == 1 && (d.usUsage == 2 || d.usUsage == 6) && d.hwndTarget) SubclassWindow(d.hwndTarget);
  }
}

// ---------------- DirectInput8 ----------------

using GetDeviceStateFn = HRESULT(STDMETHODCALLTYPE*)(IDirectInputDevice8W*, DWORD, LPVOID);
using GetDeviceDataFn = HRESULT(STDMETHODCALLTYPE*)(IDirectInputDevice8W*, DWORD, LPDIDEVICEOBJECTDATA, LPDWORD, DWORD);

VHook g_diStateW, g_diDataW, g_diStateA, g_diDataA, g_rawBuffer;
std::mutex g_devMu;
std::unordered_map<void*, DWORD> g_devType;

DWORD DeviceType(IDirectInputDevice8W* dev) {
  {
    std::lock_guard lock(g_devMu);
    const auto it = g_devType.find(dev);
    if (it != g_devType.end()) return it->second;
  }
  DIDEVCAPS caps{};
  caps.dwSize = sizeof caps;
  DWORD type = 0;
  if (SUCCEEDED(dev->GetCapabilities(&caps))) type = GET_DIDEVICE_TYPE(caps.dwDevType);
  std::lock_guard lock(g_devMu);
  g_devType[dev] = type;
  return type;
}

BYTE ScanOf(int vk) { return static_cast<BYTE>(MapVirtualKeyW(static_cast<UINT>(vk), MAPVK_VK_TO_VSC)); }

void FilterState(IDirectInputDevice8W* dev, DWORD cb, void* data) {
  const DWORD type = DeviceType(dev);
  if (type == DI8DEVTYPE_MOUSE && (cb == sizeof(DIMOUSESTATE) || cb == sizeof(DIMOUSESTATE2))) {
    ++g_diMouseState;
    if (!Interacting()) return;
    const auto* s = static_cast<const DIMOUSESTATE*>(data);
    if (!RawMouseRecent()) {
      if (s->lX || s->lY) Move(s->lX, s->lY);
      if (s->lZ) Wheel(s->lZ);
      Button(0, (s->rgbButtons[0] & 0x80) != 0);
      Button(2, (s->rgbButtons[1] & 0x80) != 0);
    }
    memset(data, 0, cb);
  } else if (type == DI8DEVTYPE_KEYBOARD && cb == 256) {
    ++g_diKbdState;
    auto* keys = static_cast<BYTE*>(data);
    if (g_typing) {
      memset(keys, 0, 256);
    } else {
      keys[ScanOf(g_holdVk)] = 0;
      keys[ScanOf(g_zoomVk)] = 0;
      if (g_big) keys[DIK_ESCAPE] = 0;
    }
  }
}

void FilterData(IDirectInputDevice8W* dev, DWORD cbObj, DIDEVICEOBJECTDATA* items, DWORD* count, DWORD flags) {
  if (!items || !count || !*count || cbObj < sizeof(DIDEVICEOBJECTDATA_DX3)) return;
  const DWORD type = DeviceType(dev);
  auto item = [&](DWORD i) { return reinterpret_cast<DIDEVICEOBJECTDATA*>(reinterpret_cast<BYTE*>(items) + i * cbObj); };
  if (type == DI8DEVTYPE_MOUSE) {
    ++g_diMouseData;
    if (!Interacting()) return;
    if (!RawMouseRecent() && !(flags & DIGDD_PEEK)) {
      for (DWORD i = 0; i < *count; ++i) {
        const DIDEVICEOBJECTDATA* it = item(i);
        switch (it->dwOfs) {
          case DIMOFS_X: Move(static_cast<LONG>(it->dwData), 0); break;
          case DIMOFS_Y: Move(0, static_cast<LONG>(it->dwData)); break;
          case DIMOFS_Z: Wheel(static_cast<LONG>(it->dwData)); break;
          case DIMOFS_BUTTON0: Button(0, (it->dwData & 0x80) != 0); break;
          case DIMOFS_BUTTON1: Button(2, (it->dwData & 0x80) != 0); break;
          default: break;
        }
      }
    }
    *count = 0;
  } else if (type == DI8DEVTYPE_KEYBOARD) {
    ++g_diKbdData;
    if (g_typing) {
      *count = 0;
      return;
    }
    const DWORD hold = ScanOf(g_holdVk), zoom = ScanOf(g_zoomVk);
    DWORD kept = 0;
    for (DWORD i = 0; i < *count; ++i) {
      const DWORD ofs = item(i)->dwOfs;
      if (ofs == hold || ofs == zoom || (g_big && ofs == DIK_ESCAPE)) continue;
      if (kept != i) memcpy(item(kept), item(i), cbObj);
      ++kept;
    }
    *count = kept;
  }
}

template <VHook* H>
HRESULT STDMETHODCALLTYPE HkGetDeviceState(IDirectInputDevice8W* dev, DWORD cb, LPVOID data) {
  const HRESULT hr = reinterpret_cast<GetDeviceStateFn>(H->original)(dev, cb, data);
  if (SUCCEEDED(hr) && data) FilterState(dev, cb, data);
  return hr;
}

template <VHook* H>
HRESULT STDMETHODCALLTYPE HkGetDeviceData(IDirectInputDevice8W* dev, DWORD cbObj, LPDIDEVICEOBJECTDATA items,
                                          LPDWORD count, DWORD flags) {
  const HRESULT hr = reinterpret_cast<GetDeviceDataFn>(H->original)(dev, cbObj, items, count, flags);
  if (SUCCEEDED(hr)) FilterData(dev, cbObj, items, count, flags);
  return hr;
}

template <typename DI, typename DEV>
void HookDirectInput(REFIID iid, VHook& state, VHook& data, void* stateFn, void* dataFn) {
  DI* di = nullptr;
  if (FAILED(DirectInput8Create(GetModuleHandleW(nullptr), DIRECTINPUT_VERSION, iid, reinterpret_cast<void**>(&di), nullptr)))
    return;
  DEV* dev = nullptr;
  if (SUCCEEDED(di->CreateDevice(GUID_SysMouse, &dev, nullptr))) {
    void** vt = *reinterpret_cast<void***>(dev);
    PatchVtable(vt, 9, stateFn, state);
    PatchVtable(vt, 10, dataFn, data);
    dev->Release();
  }
  di->Release();
}

// ---------------- GetRawInputBuffer ----------------

using GetRawInputBufferFn = UINT(WINAPI*)(PRAWINPUT, PUINT, UINT);

UINT WINAPI HkGetRawInputBuffer(PRAWINPUT data, PUINT size, UINT headerSize) {
  const UINT n = reinterpret_cast<GetRawInputBufferFn>(g_rawBuffer.original)(data, size, headerSize);
  ++g_rawBufCalls;
  if (n == 0 || n == static_cast<UINT>(-1) || !data) return n;
  const bool interacting = Interacting();
  const bool typing = g_typing;
  if (!interacting && !typing) return n;
  BYTE* read = reinterpret_cast<BYTE*>(data);
  BYTE* write = read;
  UINT kept = 0;
  for (UINT i = 0; i < n; ++i) {
    auto* ri = reinterpret_cast<RAWINPUT*>(read);
    // NEXTRAWINPUTBLOCK: entries are 8-byte aligned in 64-bit processes.
    BYTE* next = reinterpret_cast<BYTE*>((reinterpret_cast<ULONG_PTR>(read) + ri->header.dwSize + 7) & ~ULONG_PTR{7});
    bool drop = false;
    if (ri->header.dwType == RIM_TYPEMOUSE && interacting) {
      OnRawMouse(ri->data.mouse);
      drop = true;
    } else if (ri->header.dwType == RIM_TYPEKEYBOARD && typing) {
      OnRawKey(ri->data.keyboard);
      drop = true;
    }
    if (!drop) {
      const size_t len = static_cast<size_t>(next - read);
      if (write != read) memmove(write, read, len);
      write += len;
      ++kept;
    }
    read = next;
  }
  return kept;
}

}  // namespace

// ---------------- public ----------------

void Attach(HWND gameWindow) {
  g_hwnd = gameWindow;
  SubclassWindow(gameWindow);
  FollowRawInputTargets(true);
  TPLOG("input: hold key 0x%02x, zoom key 0x%02x", g_holdVk.load(), g_zoomVk.load());
}

void Detach() {
  std::lock_guard lock(g_subMu);
  for (const Subclass& s : g_subclassed) {
    if (reinterpret_cast<WNDPROC>(GetWindowLongPtrW(s.hwnd, GWLP_WNDPROC)) == &Proc)
      SetWindowLongPtrW(s.hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(s.original));
  }
  g_subclassed.clear();
  g_hwnd = nullptr;
}

void InstallDeviceHooks() {
  HookDirectInput<IDirectInput8W, IDirectInputDevice8W>(IID_IDirectInput8W, g_diStateW, g_diDataW,
                                                        reinterpret_cast<void*>(&HkGetDeviceState<&g_diStateW>),
                                                        reinterpret_cast<void*>(&HkGetDeviceData<&g_diDataW>));
  HookDirectInput<IDirectInput8A, IDirectInputDevice8A>(IID_IDirectInput8A, g_diStateA, g_diDataA,
                                                        reinterpret_cast<void*>(&HkGetDeviceState<&g_diStateA>),
                                                        reinterpret_cast<void*>(&HkGetDeviceData<&g_diDataA>));
  if (void** slot = FindImport(GetModuleHandleW(nullptr), "user32.dll", "GetRawInputBuffer")) {
    if (SwapPointer(slot, reinterpret_cast<void*>(&HkGetRawInputBuffer), &g_rawBuffer.original)) {
      g_rawBuffer.slot = slot;
      g_rawBuffer.replacement = reinterpret_cast<void*>(&HkGetRawInputBuffer);
    }
  }
  TPLOG("input: DirectInput hooks W=%d A=%d, GetRawInputBuffer import %s", g_diStateW.slot != nullptr,
        g_diStateA.slot != nullptr, g_rawBuffer.slot ? "hooked" : "not imported");
}

void RemoveDeviceHooks() {
  UnpatchVtable(g_diStateW);
  UnpatchVtable(g_diDataW);
  UnpatchVtable(g_diStateA);
  UnpatchVtable(g_diDataA);
  UnpatchVtable(g_rawBuffer);
}

void OnFrame(float dt) {
  const HWND hwnd = g_hwnd;
  if (!hwnd) return;
  const bool fg = GetForegroundWindow() == hwnd;
  const bool typing = g_typing;
  const bool holdDown = fg && !typing && (GetAsyncKeyState(g_holdVk) & 0x8000);
  const bool zoomDown = fg && !typing && (GetAsyncKeyState(g_zoomVk) & 0x8000);
  const bool escDown = fg && (GetAsyncKeyState(VK_ESCAPE) & 0x8000);

  if (zoomDown && !g_zoomWas) SetBig(!g_big);
  if (escDown && !g_escWas && !typing) {
    if (g_big) {
      SetBig(false);
    } else {
      g_menu = !g_menu;
      JsonWriter w;
      w.beginObject().str("t", "menu").boolean("open", g_menu).endObject();
      pipe::Send(w.text());
    }
  }
  g_zoomWas = zoomDown;
  g_escWas = escDown;
  g_holding = holdDown;

  const bool interacting = Interacting();
  if (interacting != g_wasInteracting) {
    if (!interacting) {
      Button(0, false);
      Button(2, false);
    }
    float x, y;
    {
      std::lock_guard lock(g_ptrMu);
      x = g_x;
      y = g_y;
      g_moved = false;
      g_wheel = 0;
    }
    SendPointer(interacting ? "enter" : "leave", x, y);
    g_wasInteracting = interacting;
  } else if (interacting) {
    float x, y;
    bool moved;
    int wheel;
    {
      std::lock_guard lock(g_ptrMu);
      x = g_x;
      y = g_y;
      moved = g_moved;
      wheel = g_wheel;
      g_moved = false;
      g_wheel = 0;
    }
    if (moved) SendPointer("move", x, y);
    if (wheel) SendPointer("wheel", x, y, -1, wheel);
  }

  // Big view spring (a touch of bounce, like a sheet settling).
  const float target = g_big ? 1.0f : 0.0f;
  constexpr float k = 230.0f;
  const float c = 2.0f * std::sqrt(k) * 0.78f;
  const int steps = static_cast<int>(std::ceil(dt / 0.004f));
  const float h = steps ? dt / static_cast<float>(steps) : 0.0f;
  for (int i = 0; i < steps; ++i) {
    g_bigVel += (k * (target - g_bigPos) - c * g_bigVel) * h;
    g_bigPos += g_bigVel * h;
  }
  if (target == 0.0f && g_bigPos < 0.002f && std::fabs(g_bigVel) < 0.05f) g_bigPos = g_bigVel = 0;

  g_rawCheckTimer += dt;
  if (g_rawCheckTimer > 2.0f) {
    g_rawCheckTimer = 0;
    FollowRawInputTargets(false);
  }
}

void SetMenu(bool open) { g_menu = open; }
bool MenuOpen() { return g_menu; }

void Configure(const std::string& cfg) {
  g_holdVk = static_cast<int>(JsonNumber(cfg, "holdVk", g_holdVk));
  g_zoomVk = static_cast<int>(JsonNumber(cfg, "zoomVk", g_zoomVk));
  g_sens = static_cast<float>(JsonNumber(cfg, "sens", g_sens));
  SetScreenAspect(static_cast<float>(JsonNumber(cfg, "aspect", g_aspect)));
  TPLOG("input: configured hold=0x%02x zoom=0x%02x sens=%.2f", g_holdVk.load(), g_zoomVk.load(), g_sens.load());
}

void SetTyping(bool on) {
  if (g_typing == on) return;
  g_typing = on;
  g_wmCharSeen = false;
  TPLOG("input: typing %s", on ? "on" : "off");
}

void SetBig(bool on) {
  if (g_big == on) return;
  g_big = on;
  JsonWriter w;
  w.beginObject().str("t", "mode").boolean("big", on).endObject();
  pipe::Send(w.text());
}

void SetScreenAspect(float aspect) {
  if (aspect > 0.2f && aspect < 5.0f) g_aspect = aspect;
}

bool Interacting() { return g_holding || g_big || g_forced; }

float BigAmount() { return g_bigPos; }

PointerState Pointer() {
  std::lock_guard lock(g_ptrMu);
  return {g_x, g_y, Interacting(), g_left};
}

void ForcePointer(bool on, float x, float y, bool pressed) {
  {
    std::lock_guard lock(g_ptrMu);
    const float nx = std::fmin(1.0f, std::fmax(0.0f, x)), ny = std::fmin(1.0f, std::fmax(0.0f, y));
    if (nx != g_x || ny != g_y) g_moved = true;
    g_x = nx;
    g_y = ny;
  }
  g_forced = on;
  if (on) Button(0, pressed);  // down/up go out like a real click
}

void ForceWheel(int delta) { Wheel(delta); }

std::string StatsJson() {
  JsonWriter w;
  w.beginObject()
      .integer("wmInput", static_cast<long long>(g_wmInput.load()))
      .integer("wmInputMouse", static_cast<long long>(g_wmInputMouse.load()))
      .integer("wmInputKbd", static_cast<long long>(g_wmInputKbd.load()))
      .integer("wmMouse", static_cast<long long>(g_wmMouse.load()))
      .integer("wmKey", static_cast<long long>(g_wmKey.load()))
      .integer("wmChar", static_cast<long long>(g_wmChar.load()))
      .integer("diMouseState", static_cast<long long>(g_diMouseState.load()))
      .integer("diMouseData", static_cast<long long>(g_diMouseData.load()))
      .integer("diKbdState", static_cast<long long>(g_diKbdState.load()))
      .integer("diKbdData", static_cast<long long>(g_diKbdData.load()))
      .integer("rawBuffer", static_cast<long long>(g_rawBufCalls.load()))
      .boolean("holding", g_holding)
      .boolean("big", g_big)
      .boolean("typing", g_typing)
      .endObject();
  return w.text();
}

}  // namespace tp::input
