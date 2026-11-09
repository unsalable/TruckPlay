// TruckPlay game plugin: loaded by ETS2 from bin\win_x64\plugins through the official telemetry SDK.

#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>

#include <scssdk_telemetry.h>
#include <eurotrucks2/scssdk_eut2.h>

#include "d3d_hooks.h"
#include "frames.h"
#include "input.h"
#include "json.h"
#include "log.h"
#include "pipe.h"
#include "pointer.h"
#include "gamedraw.h"
#include "telemetry.h"

namespace {

constexpr char kVersion[] = "1.8.1";
bool g_running = false;

void OnHostMessage(const std::string& line) {
  const std::string type = tp::JsonString(line, "t");
  if (type == "targets") {
    tp::pointer::SetTargets(line);
  } else if (type == "cfg") {
    tp::input::Configure(line);
    tp::pointer::Configure(line);
  } else if (type == "typing") {
    tp::input::SetTyping(tp::JsonBool(line, "on", false));
  } else if (type == "menu") {
    tp::input::SetMenu(tp::JsonBool(line, "open", false));
  } else if (type == "layout") {
    tp::d3d::SetLayout(line);
  } else if (type == "advisor") {
    tp::d3d::SetAdvisor(tp::JsonBool(line, "on", false));
  } else if (type == "mapfeed") {
    tp::gamedraw::SetFeed(tp::JsonBool(line, "on", false), tp::JsonBool(line, "premul", false));
  } else if (type == "big") {
    tp::input::SetBig(tp::JsonBool(line, "on", false));
  } else if (type == "hello") {
    TPLOG("host: %s", line.c_str());
  }
}

// The game's own version ("1.62.1") and folder, from its executable: the host makes the mod
// again for a new game version (a mod made for the old one is left out by the game).
std::string GameVersion() {
  wchar_t exe[MAX_PATH];
  if (!GetModuleFileNameW(nullptr, exe, MAX_PATH)) return {};
  DWORD ignored = 0;
  const DWORD size = GetFileVersionInfoSizeW(exe, &ignored);
  if (!size) return {};
  std::vector<BYTE> info(size);
  VS_FIXEDFILEINFO* fixed = nullptr;
  UINT len = 0;
  if (!GetFileVersionInfoW(exe, 0, size, info.data()) || !VerQueryValueW(info.data(), L"\\", reinterpret_cast<void**>(&fixed), &len) ||
      !fixed) {
    return {};
  }
  char v[32];
  snprintf(v, sizeof v, "%u.%u.%u", HIWORD(fixed->dwProductVersionMS), LOWORD(fixed->dwProductVersionMS),
           HIWORD(fixed->dwProductVersionLS));
  return v;
}

std::string GameDir() {
  wchar_t exe[MAX_PATH];
  const DWORD n = GetModuleFileNameW(nullptr, exe, MAX_PATH);
  std::wstring dir(exe, n);
  for (int i = 0; i < 3; ++i) dir = dir.substr(0, dir.find_last_of(L"\\/"));  // …\bin\win_x64\eurotrucks2.exe
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, dir.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string out(bytes > 0 ? bytes - 1 : 0, '\0');
  if (bytes > 0) WideCharToMultiByte(CP_UTF8, 0, dir.c_str(), -1, out.data(), bytes, nullptr, nullptr);
  return out;
}

std::vector<std::string> OnHostConnect() {
  tp::input::SetTyping(false);
  tp::input::SetBig(false);
  tp::JsonWriter w;
  // pointer: the plugin draws the pointer itself; the UI only reports its targets.
  w.beginObject().str("t", "hello").str("plugin", kVersion).str("game", "eut2").str("sdk", tp::TelemetrySdkVersion());
  w.str("gameVersion", GameVersion()).str("gameDir", GameDir());
  w.boolean("pointer", true).endObject();
  return {w.text(), tp::d3d::ScreenJson(), tp::d3d::ViewJson(), tp::gamedraw::Status()};
}

// The installer writes the host's command line to truckplay\launch.txt so the "phone" starts with
// the game. The host keeps a single instance, so launching it again is harmless.
void LaunchHost() {
  const std::wstring file = tp::PluginDataDir() + L"\\launch.txt";
  HANDLE f = CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
  if (f == INVALID_HANDLE_VALUE) return;
  char buf[2048] = {};
  DWORD got = 0;
  ReadFile(f, buf, sizeof buf - 1, &got, nullptr);
  CloseHandle(f);
  std::string line(buf, got);
  if (line.size() >= 3 && static_cast<unsigned char>(line[0]) == 0xef) line.erase(0, 3);  // UTF-8 BOM
  line = line.substr(0, line.find_first_of("\r\n"));
  if (line.empty()) return;
  std::wstring cmd(MultiByteToWideChar(CP_UTF8, 0, line.c_str(), -1, nullptr, 0), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, line.c_str(), -1, cmd.data(), static_cast<int>(cmd.size()));
  STARTUPINFOW si{sizeof si};
  PROCESS_INFORMATION pi{};
  const DWORD flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP;
  BOOL ok = CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, flags | CREATE_BREAKAWAY_FROM_JOB, nullptr, nullptr, &si, &pi);
  if (!ok) ok = CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, flags, nullptr, nullptr, &si, &pi);
  if (ok) {
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    TPLOG("host launched (pid %lu)", pi.dwProcessId);
  } else {
    TPLOG("host launch failed (%lu): %s", GetLastError(), line.c_str());
  }
}

// If the host goes away while the game runs (it crashed, or was closed), start it again: a few
// times, spaced out, so a host that cannot start does not loop.
std::thread g_watchdog;
std::mutex g_watchMu;
std::condition_variable g_watchCv;
bool g_watchStop = false;

void Watch() {
  using clock = std::chrono::steady_clock;
  auto seen = clock::now(), launched = clock::now();
  int launches = 0;
  std::unique_lock lock(g_watchMu);
  while (!g_watchCv.wait_for(lock, std::chrono::seconds(2), [] { return g_watchStop; })) {
    const auto now = clock::now();
    if (tp::pipe::Connected()) {
      // A host that ran is a host that can run: if it goes away later, it gets its tries again.
      seen = now;
      launches = 0;
      continue;
    }
    if (launches >= 5 || now - seen < std::chrono::seconds(10) || now - launched < std::chrono::seconds(30)) continue;
    TPLOG("host gone for %llds: starting it again", static_cast<long long>(std::chrono::duration_cast<std::chrono::seconds>(now - seen).count()));
    lock.unlock();
    LaunchHost();
    lock.lock();
    launched = clock::now();
    ++launches;
  }
}

void Start() {
  if (g_running) return;
  g_running = true;
  tp::frames::Open();
  tp::d3d::Install();
  tp::input::InstallDeviceHooks();
  tp::pipe::Start(OnHostMessage, OnHostConnect);
  LaunchHost();
  g_watchStop = false;
  g_watchdog = std::thread(Watch);
}

void Stop() {
  if (!g_running) return;
  g_running = false;
  {
    std::lock_guard lock(g_watchMu);
    g_watchStop = true;
  }
  g_watchCv.notify_all();
  if (g_watchdog.joinable()) g_watchdog.join();
  tp::pipe::Stop();
  tp::input::Detach();
  tp::input::RemoveDeviceHooks();
  tp::d3d::Uninstall();
  tp::frames::Close();
  TPLOG("stopped");
  tp::LogClose();
}

}  // namespace

SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t* const params) {
  if (version != SCS_TELEMETRY_VERSION_1_01 && version != SCS_TELEMETRY_VERSION_1_00) return SCS_RESULT_unsupported;
  const auto* p = static_cast<const scs_telemetry_init_params_v101_t*>(params);
  tp::LogInit();
  TPLOG("TruckPlay %s loading into %s", kVersion, p->common.game_id);
  if (strcmp(p->common.game_id, SCS_GAME_ID_EUT2) != 0) TPLOG("note: not ETS2 (%s), continuing anyway", p->common.game_id);
  if (!tp::TelemetryInit(p)) {
    p->common.log(SCS_LOG_TYPE_error, "[tirplay] telemetry registration failed");
    return SCS_RESULT_generic_error;
  }
  Start();
  p->common.log(SCS_LOG_TYPE_message, "[tirplay] loaded");
  return SCS_RESULT_ok;
}

SCSAPI_VOID scs_telemetry_shutdown(void) { Stop(); }

// Used by test/hooktest.cpp to exercise the hooks without the game.
extern "C" int tirplay_selftest_start() {
  tp::LogInit();
  TPLOG("TruckPlay %s self-test", kVersion);
  Start();
  return 1;
}

extern "C" void tirplay_selftest_stop() { Stop(); }

extern "C" void tirplay_selftest_big(int on) { tp::input::SetBig(on != 0); }

// Pointer tests: a host message as the host would send it, and the mouse without a mouse.
extern "C" void tirplay_selftest_message(const char* line) { OnHostMessage(line); }

extern "C" void tirplay_selftest_pointer(int on, float x, float y, int pressed) {
  tp::input::ForcePointer(on != 0, x, y, pressed != 0);
}

extern "C" void tirplay_selftest_wheel(int delta) { tp::input::ForceWheel(delta); }

// A message to the host as if the plugin sent it (the test cab's "js" steps).
extern "C" void tirplay_selftest_send(const char* line) { tp::pipe::Send(line); }

BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID) { return TRUE; }
