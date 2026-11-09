// TruckPlay-Kurulum.exe: TruckPlay in one file. The app (a zip of dist/TruckPlay) rides at the end
// of this program, followed by an 8-byte offset and the marker "TPSETUP1". The installer unpacks it
// into a fresh folder under %TEMP% (with Windows' own tar) and runs its setup.ps1, which finds the
// game, installs the plugin and the app, and builds the mod from the player's own game files.
//
//   TruckPlay-Kurulum.exe              install or update
//   TruckPlay-Kurulum.exe -Uninstall   remove (the arguments go on to setup.ps1)
//   TruckPlay-Kurulum.exe -Update <folder> …   TruckPlay updating itself (host/src/updater.js):
//                                      no window at all, nothing to answer

#include <windows.h>

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace {

constexpr char kMarker[8] = {'T', 'P', 'S', 'E', 'T', 'U', 'P', '1'};

// -Update: started hidden by TruckPlay itself. Nothing shows (tar and PowerShell get no console
// window either) and nothing waits for a key.
bool g_quiet = false;

// Console text in any language: WriteConsoleW, not the C runtime's locale-bound printf.
void Say(const std::wstring& text) {
  if (g_quiet) return;
  DWORD n = 0;
  WriteConsoleW(GetStdHandle(STD_OUTPUT_HANDLE), text.c_str(), static_cast<DWORD>(text.size()), &n, nullptr);
}

std::wstring ExePath() {
  std::wstring path(MAX_PATH, L'\0');
  for (;;) {
    const DWORD n = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (n < path.size()) {
      path.resize(n);
      return path;
    }
    path.resize(path.size() * 2);
  }
}

int Fail(const wchar_t* what) {
  const DWORD err = GetLastError();
  Say(std::wstring(L"\n  Kurulum açılamadı: ") + what + L" (hata " + std::to_wstring(err) + L")\n\n");
  if (!g_quiet) system("pause");
  return 1;
}

int Run(std::wstring cmd) {
  STARTUPINFOW si{sizeof si};
  PROCESS_INFORMATION pi{};
  const DWORD flags = g_quiet ? CREATE_NO_WINDOW : 0;
  if (!CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, flags, nullptr, nullptr, &si, &pi)) return -1;
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return static_cast<int>(code);
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  for (int i = 1; i < argc; ++i) {
    if (_wcsicmp(argv[i], L"-Update") == 0) g_quiet = true;
  }
  SetConsoleOutputCP(CP_UTF8);
  SetConsoleTitleW(L"TruckPlay kurulumu");
  Say(L"\n  TruckPlay kurulumu\n  ------------------\n  Hazırlanıyor…\n");

  // The payload: [zip][u64 offset of the zip][marker].
  const HANDLE self = CreateFileW(ExePath().c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
  if (self == INVALID_HANDLE_VALUE) return Fail(L"kendi dosyası okunamadı");
  LARGE_INTEGER size{};
  GetFileSizeEx(self, &size);
  char tail[16] = {};
  LARGE_INTEGER at{};
  at.QuadPart = size.QuadPart - 16;
  DWORD got = 0;
  if (size.QuadPart < 16 || !SetFilePointerEx(self, at, nullptr, FILE_BEGIN) || !ReadFile(self, tail, 16, &got, nullptr) || got != 16 ||
      memcmp(tail + 8, kMarker, 8) != 0) {
    CloseHandle(self);
    return Fail(L"içindeki uygulama bulunamadı");
  }
  uint64_t offset = 0;
  memcpy(&offset, tail, 8);
  const uint64_t length = static_cast<uint64_t>(size.QuadPart) - 16 - offset;

  // A fresh staging folder.
  wchar_t temp[MAX_PATH];
  GetTempPathW(MAX_PATH, temp);
  const std::wstring stage = std::wstring(temp) + L"TruckPlaySetup-" + std::to_wstring(GetCurrentProcessId());
  CreateDirectoryW(stage.c_str(), nullptr);
  const std::wstring zip = stage + L"\\app.zip";

  const HANDLE out = CreateFileW(zip.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, nullptr);
  if (out == INVALID_HANDLE_VALUE) {
    CloseHandle(self);
    return Fail(L"geçici klasöre yazılamadı");
  }
  at.QuadPart = static_cast<LONGLONG>(offset);
  SetFilePointerEx(self, at, nullptr, FILE_BEGIN);
  std::vector<char> buf(1 << 20);
  for (uint64_t left = length; left > 0;) {
    const DWORD want = static_cast<DWORD>(left < buf.size() ? left : buf.size());
    DWORD n = 0, written = 0;
    if (!ReadFile(self, buf.data(), want, &n, nullptr) || n == 0 || !WriteFile(out, buf.data(), n, &written, nullptr)) {
      CloseHandle(out);
      CloseHandle(self);
      return Fail(L"uygulama açılamadı");
    }
    left -= n;
  }
  CloseHandle(out);
  CloseHandle(self);

  // Windows' own tar unpacks zip files (Windows 10 1803 and later).
  wchar_t sys[MAX_PATH];
  GetSystemDirectoryW(sys, MAX_PATH);
  Say(L"  Dosyalar açılıyor…\n");
  const std::wstring app = stage + L"\\app";
  CreateDirectoryW(app.c_str(), nullptr);
  if (Run(L"\"" + std::wstring(sys) + L"\\tar.exe\" -xf \"" + zip + L"\" -C \"" + app + L"\"") != 0) return Fail(L"dosyalar açılamadı");
  DeleteFileW(zip.c_str());

  std::wstring cmd = L"\"" + std::wstring(sys) + L"\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -ExecutionPolicy Bypass -File \"" + app +
                     L"\\setup.ps1\" -Source \"" + app + L"\"";
  for (int i = 1; i < argc; ++i) cmd += std::wstring(L" \"") + argv[i] + L"\"";
  const int code = Run(cmd);

  // The staging copy is no longer needed (setup.ps1 copied what stays).
  Run(L"cmd /c rmdir /s /q \"" + stage + L"\"");
  return code;
}
