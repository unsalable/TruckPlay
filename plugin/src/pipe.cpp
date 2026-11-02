#include <windows.h>

#include <atomic>
#include <chrono>
#include <cwchar>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <vector>

#include "log.h"
#include "pipe.h"
#include "telemetry.h"

namespace tp::pipe {
namespace {

constexpr auto kTelemetryPeriod = std::chrono::milliseconds(50);

// TRUCKPLAY_PIPE renames the pipe so the hook test can run beside a live game.
const wchar_t* PipeName() {
  static wchar_t name[128] = L"\\\\.\\pipe\\tirplay";
  static bool once = false;
  if (!once) {
    once = true;
    wchar_t custom[96];
    if (GetEnvironmentVariableW(L"TRUCKPLAY_PIPE", custom, 96) - 1 < 95) swprintf_s(name, L"\\\\.\\pipe\\%s", custom);
  }
  return name;
}

std::thread g_thread;
std::atomic<bool> g_stop{false};
std::atomic<bool> g_connected{false};
std::mutex g_mu;
std::condition_variable g_cv;
std::vector<std::string> g_queue;
std::function<void(const std::string&)> g_onMessage;
std::function<std::vector<std::string>()> g_onConnect;

bool WriteAll(HANDLE h, const std::string& s) {
  const char* p = s.data();
  size_t left = s.size();
  while (left) {
    DWORD wrote = 0;
    if (!WriteFile(h, p, static_cast<DWORD>(left), &wrote, nullptr)) return false;
    p += wrote;
    left -= wrote;
  }
  return true;
}

void Serve(HANDLE h) {
  std::string inbox;
  auto lastTelemetry = std::chrono::steady_clock::now() - kTelemetryPeriod;
  {
    std::lock_guard lock(g_mu);
    g_queue.clear();
  }
  for (std::string& line : g_onConnect()) {
    if (!WriteAll(h, line + "\n")) return;
  }

  while (!g_stop) {
    DWORD avail = 0;
    if (!PeekNamedPipe(h, nullptr, 0, nullptr, &avail, nullptr)) return;
    if (avail) {
      std::string chunk(avail, '\0');
      DWORD got = 0;
      if (!ReadFile(h, chunk.data(), avail, &got, nullptr)) return;
      inbox.append(chunk.data(), got);
      size_t nl;
      while ((nl = inbox.find('\n')) != std::string::npos) {
        std::string line = inbox.substr(0, nl);
        inbox.erase(0, nl + 1);
        if (!line.empty() && g_onMessage) g_onMessage(line);
      }
    }

    std::vector<std::string> out;
    {
      std::unique_lock lock(g_mu);
      g_cv.wait_for(lock, std::chrono::milliseconds(8), [] { return !g_queue.empty() || g_stop.load(); });
      out.swap(g_queue);
    }
    const auto now = std::chrono::steady_clock::now();
    if (now - lastTelemetry >= kTelemetryPeriod) {
      lastTelemetry = now;
      out.push_back(TelemetryJson());
      for (std::string& e : TelemetryDrainEvents()) out.push_back(std::move(e));
    }
    if (!out.empty()) {
      std::string batch;
      for (const std::string& l : out) {
        batch += l;
        batch += '\n';
      }
      if (!WriteAll(h, batch)) return;
    }
  }
}

void Loop() {
  while (!g_stop) {
    HANDLE h = CreateNamedPipeW(PipeName(), PIPE_ACCESS_DUPLEX, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1, 1 << 20,
                                1 << 20, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
      TPLOG("pipe: create failed (%lu)", GetLastError());
      Sleep(1000);
      continue;
    }
    const BOOL ok = ConnectNamedPipe(h, nullptr) ? TRUE : GetLastError() == ERROR_PIPE_CONNECTED;
    if (ok && !g_stop) {
      TPLOG("pipe: host connected");
      g_connected = true;
      Serve(h);
      g_connected = false;
      TPLOG("pipe: host disconnected");
    }
    DisconnectNamedPipe(h);
    CloseHandle(h);
  }
}

}  // namespace

void Start(std::function<void(const std::string&)> onMessage, std::function<std::vector<std::string>()> onConnect) {
  g_onMessage = std::move(onMessage);
  g_onConnect = std::move(onConnect);
  g_stop = false;
  g_thread = std::thread(Loop);
}

void Stop() {
  if (!g_thread.joinable()) return;
  g_stop = true;
  g_cv.notify_all();
  // Unblock a pending ConnectNamedPipe by connecting to ourselves.
  HANDLE self = CreateFileW(PipeName(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
  if (self != INVALID_HANDLE_VALUE) CloseHandle(self);
  g_thread.join();
}

void Send(std::string line) {
  if (!g_connected) return;
  {
    std::lock_guard lock(g_mu);
    if (g_queue.size() > 512) g_queue.erase(g_queue.begin(), g_queue.begin() + 256);
    g_queue.push_back(std::move(line));
  }
  g_cv.notify_one();
}

bool Connected() { return g_connected; }

}  // namespace tp::pipe
