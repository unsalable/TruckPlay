#include "log.h"

#include <windows.h>

#include <cstdarg>
#include <cstdio>
#include <mutex>

namespace tp {
namespace {

std::mutex g_mu;
FILE* g_file = nullptr;
std::wstring g_dir;

std::wstring ModuleDir() {
  HMODULE self = nullptr;
  GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                     reinterpret_cast<LPCWSTR>(&ModuleDir), &self);
  wchar_t buf[MAX_PATH];
  const DWORD n = GetModuleFileNameW(self, buf, MAX_PATH);
  std::wstring path(buf, n);
  const size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? L"." : path.substr(0, slash);
}

}  // namespace

std::wstring PluginDataDir() {
  if (g_dir.empty()) {
    g_dir = ModuleDir() + L"\\truckplay";
    CreateDirectoryW(g_dir.c_str(), nullptr);
  }
  return g_dir;
}

void LogInit() {
  std::lock_guard lock(g_mu);
  if (g_file) return;
  const std::wstring path = PluginDataDir() + L"\\truckplay.log";
  g_file = _wfopen(path.c_str(), L"w");
}

void LogClose() {
  std::lock_guard lock(g_mu);
  if (g_file) fclose(g_file);
  g_file = nullptr;
}

void Log(const char* fmt, ...) {
  char msg[2048];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof msg, fmt, ap);
  va_end(ap);
  SYSTEMTIME st;
  GetLocalTime(&st);
  std::lock_guard lock(g_mu);
  if (!g_file) return;
  fprintf(g_file, "%02d:%02d:%02d.%03d [%5lu] %s\n", st.wHour, st.wMinute, st.wSecond, st.wMilliseconds,
          GetCurrentThreadId(), msg);
  fflush(g_file);
}

}  // namespace tp
