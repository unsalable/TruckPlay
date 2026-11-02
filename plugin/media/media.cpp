// truckplay-media.exe: what is playing on the PC (Spotify, Apple Music, a browser tab…), read from
// Windows' media sessions (GSMTC), for TruckPlay's Music and Now Playing. The host starts it and
// talks JSON lines: state out on stdout, commands in on stdin. It exits when stdin closes.
//
// out  {"t":"sessions","current":"s1","list":[{"id","app","title","artist","album","status","pos","dur","ts",
//        "shuffle","repeat","caps":{…}}]}
//      {"t":"art","id":"s1","key":"…","data":"data:image/…;base64,…"}      when a session's artwork changes
//      {"t":"app","app":"Spotify.exe","name":"Spotify","icon":"data:…"}   once per app
// in   {"t":"cmd","id":"s1","cmd":"play|pause|toggle|next|prev|seek|shuffle|repeat","v":0}
//      {"t":"refresh"}
//      {"t":"volume","level":0.7,"pids":[1234],"apps":["spotify.exe"]}
//        sets the Windows mixer volume of the audio sessions of those processes (and everything
//        they started) and of those apps; kept up as new sessions appear (the next song, a page
//        starting a video).
//      {"t":"launch","app":"spotify"}
//        starts Spotify (desktop or Microsoft Store version) minimized — never in front of the
//        game — and once its media session appears, has it play on where it left off.
//        Answers {"t":"launched","app":"spotify","ok":bool,"how":"running|desktop|store|none"}.

#include <windows.h>
#include <audiopolicy.h>
#include <shobjidl.h>
#include <fcntl.h>
#include <mmdeviceapi.h>
#include <io.h>
#include <tlhelp32.h>

#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.Control.h>
#include <winrt/Windows.Storage.FileProperties.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Storage.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cwctype>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <iostream>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "../src/json.h"

#pragma comment(lib, "windowsapp")
#pragma comment(lib, "version")

using namespace winrt;
using namespace Windows::Media::Control;
using namespace Windows::Storage::Streams;
using tp::JsonWriter;

namespace {

std::mutex g_outMu;
std::mutex g_mu;  // sessions and caches
std::condition_variable g_wake;
std::atomic<bool> g_dirty{true};
std::atomic<bool> g_quit{false};

void Emit(const std::string& line) {
  std::lock_guard lock(g_outMu);
  fwrite(line.data(), 1, line.size(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

void Poke() {
  g_dirty = true;
  g_wake.notify_one();
}

std::string Base64(const std::vector<uint8_t>& in) {
  static const char k[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((in.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < in.size(); i += 3) {
    const uint32_t v = (in[i] << 16) | (in[i + 1] << 8) | in[i + 2];
    out += k[v >> 18];
    out += k[(v >> 12) & 63];
    out += k[(v >> 6) & 63];
    out += k[v & 63];
  }
  if (i + 1 == in.size()) {
    const uint32_t v = in[i] << 16;
    out += k[v >> 18];
    out += k[(v >> 12) & 63];
    out += "==";
  } else if (i + 2 == in.size()) {
    const uint32_t v = (in[i] << 16) | (in[i + 1] << 8);
    out += k[v >> 18];
    out += k[(v >> 12) & 63];
    out += k[(v >> 6) & 63];
    out += '=';
  }
  return out;
}

// Reads a whole stream (artwork, logos), up to `limit` bytes.
std::string DataUrl(const IRandomAccessStreamWithContentType& s, size_t limit = 1500000) {
  const uint64_t size = s.Size();
  if (!size || size > limit) return {};
  DataReader reader(s);
  reader.LoadAsync(static_cast<uint32_t>(size)).get();
  std::vector<uint8_t> bytes(static_cast<size_t>(size));
  reader.ReadBytes(bytes);
  std::string type = to_string(s.ContentType());
  if (type.empty()) type = "image/png";
  return "data:" + type + ";base64," + Base64(bytes);
}

// ---------------- apps: names and icons ----------------

std::set<std::string> g_appsSent;

std::wstring ProcessPath(const std::wstring& exe) {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return {};
  PROCESSENTRY32W pe{sizeof pe};
  std::wstring path;
  for (BOOL ok = Process32FirstW(snap, &pe); ok && path.empty(); ok = Process32NextW(snap, &pe)) {
    if (_wcsicmp(pe.szExeFile, exe.c_str()) != 0) continue;
    if (HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID)) {
      wchar_t buf[MAX_PATH];
      DWORD n = MAX_PATH;
      if (QueryFullProcessImageNameW(p, 0, buf, &n)) path.assign(buf, n);
      CloseHandle(p);
    }
  }
  CloseHandle(snap);
  return path;
}

std::wstring FileDescription(const std::wstring& file) {
  DWORD dummy = 0;
  const DWORD size = GetFileVersionInfoSizeW(file.c_str(), &dummy);
  if (!size) return {};
  std::vector<uint8_t> data(size);
  if (!GetFileVersionInfoW(file.c_str(), 0, size, data.data())) return {};
  struct Lang {
    WORD lang, page;
  }* langs = nullptr;
  UINT len = 0;
  if (!VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<void**>(&langs), &len) || len < sizeof(Lang))
    return {};
  wchar_t key[64];
  swprintf_s(key, L"\\StringFileInfo\\%04x%04x\\FileDescription", langs[0].lang, langs[0].page);
  wchar_t* value = nullptr;
  if (!VerQueryValueW(data.data(), key, reinterpret_cast<void**>(&value), &len) || !len) return {};
  return value;
}

// Name and icon of the app behind a session: packaged apps (Apple Music, Spotify from the Store)
// through their app info, desktop apps (Spotify.exe, browsers) from the running executable.
void SendApp(const std::string& aumid) {
  if (aumid.empty() || g_appsSent.count(aumid)) return;
  g_appsSent.insert(aumid);
  std::string name, icon;
  try {
    const auto info = Windows::ApplicationModel::AppInfo::GetFromAppUserModelId(to_hstring(aumid));
    name = to_string(info.DisplayInfo().DisplayName());
    const auto logo = info.DisplayInfo().GetLogo(Windows::Foundation::Size(96, 96));
    icon = DataUrl(logo.OpenReadAsync().get());
  } catch (...) {
    // not a packaged app
  }
  if (name.empty() || icon.empty()) {
    std::wstring exe = to_hstring(aumid).c_str();
    if (exe.size() < 4 || _wcsicmp(exe.c_str() + exe.size() - 4, L".exe") != 0) exe += L".exe";
    const std::wstring path = ProcessPath(exe);
    if (!path.empty()) {
      if (name.empty()) name = to_string(hstring(FileDescription(path)));
      try {
        const auto file = Windows::Storage::StorageFile::GetFileFromPathAsync(path).get();
        const auto thumb = file.GetThumbnailAsync(Windows::Storage::FileProperties::ThumbnailMode::SingleItem, 96).get();
        if (thumb && icon.empty()) icon = DataUrl(thumb);
      } catch (...) {
      }
    }
  }
  if (name.empty()) {
    name = aumid;
    if (name.size() > 4 && _stricmp(name.c_str() + name.size() - 4, ".exe") == 0) name.resize(name.size() - 4);
  }
  JsonWriter w;
  w.beginObject().str("t", "app").str("app", aumid).str("name", name).str("icon", icon).endObject();
  Emit(w.text());
}

// ---------------- sessions ----------------

struct Tracked {
  std::string id;
  GlobalSystemMediaTransportControlsSession session{nullptr};
  event_token props{}, playback{}, timeline{};
  std::string artKey;
};

GlobalSystemMediaTransportControlsSessionManager g_manager{nullptr};
std::vector<Tracked> g_sessions;
int g_nextId = 1;
std::string g_lastState;

void Untrack(Tracked& t) {
  try {
    t.session.MediaPropertiesChanged(t.props);
    t.session.PlaybackInfoChanged(t.playback);
    t.session.TimelinePropertiesChanged(t.timeline);
  } catch (...) {
  }
}

void SyncSessions() {
  std::vector<GlobalSystemMediaTransportControlsSession> now;
  for (const auto& s : g_manager.GetSessions()) now.push_back(s);
  std::vector<Tracked> kept;
  for (Tracked& t : g_sessions) {
    bool alive = false;
    for (const auto& s : now) alive = alive || s == t.session;
    if (alive) kept.push_back(t);
    else Untrack(t);
  }
  for (const auto& s : now) {
    bool known = false;
    for (const Tracked& t : kept) known = known || t.session == s;
    if (known) continue;
    Tracked t;
    t.id = "s" + std::to_string(g_nextId++);
    t.session = s;
    t.props = s.MediaPropertiesChanged([](auto&&, auto&&) { Poke(); });
    t.playback = s.PlaybackInfoChanged([](auto&&, auto&&) { Poke(); });
    t.timeline = s.TimelinePropertiesChanged([](auto&&, auto&&) { Poke(); });
    kept.push_back(t);
  }
  g_sessions = std::move(kept);
}

const char* StatusName(GlobalSystemMediaTransportControlsSessionPlaybackStatus s) {
  switch (s) {
    case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing: return "playing";
    case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused: return "paused";
    case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped: return "stopped";
    case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing: return "changing";
    case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened: return "opened";
    default: return "closed";
  }
}

double Seconds(Windows::Foundation::TimeSpan t) { return std::chrono::duration<double>(t).count(); }

double UnixMs(Windows::Foundation::DateTime t) {
  const auto sys = clock::to_sys(t);
  return static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(sys.time_since_epoch()).count());
}

// Publishes the full state when anything changed; artwork and app icons only when they are new.
void Publish() {
  std::lock_guard lock(g_mu);
  SyncSessions();
  std::string current;
  try {
    if (const auto cur = g_manager.GetCurrentSession()) {
      for (const Tracked& t : g_sessions)
        if (t.session == cur) current = t.id;
    }
  } catch (...) {
  }

  JsonWriter w;
  w.beginObject().str("t", "sessions").str("current", current);
  std::string list = "[";
  std::vector<std::pair<Tracked*, Windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties>> artToSend;
  for (Tracked& t : g_sessions) {
    try {
      const std::string app = to_string(t.session.SourceAppUserModelId());
      const auto props = t.session.TryGetMediaPropertiesAsync().get();
      const auto info = t.session.GetPlaybackInfo();
      const auto tl = t.session.GetTimelineProperties();
      const auto caps = info.Controls();
      JsonWriter s;
      s.beginObject().str("id", t.id).str("app", app);
      s.str("title", to_string(props.Title())).str("artist", to_string(props.Artist()));
      s.str("album", to_string(props.AlbumTitle())).str("status", StatusName(info.PlaybackStatus()));
      const double start = Seconds(tl.StartTime()), end = Seconds(tl.EndTime());
      s.num("pos", Seconds(tl.Position()) - start, 6).num("dur", end > start ? end - start : 0, 6);
      s.num("ts", UnixMs(tl.LastUpdatedTime()), 15);
      if (const auto shuffle = info.IsShuffleActive()) s.boolean("shuffle", shuffle.Value());
      if (const auto repeat = info.AutoRepeatMode()) {
        const auto m = repeat.Value();
        s.str("repeat", m == Windows::Media::MediaPlaybackAutoRepeatMode::Track ? "track"
                        : m == Windows::Media::MediaPlaybackAutoRepeatMode::List ? "list" : "none");
      }
      s.beginObject("caps")
          .boolean("play", caps.IsPlayEnabled())
          .boolean("pause", caps.IsPauseEnabled())
          .boolean("next", caps.IsNextEnabled())
          .boolean("prev", caps.IsPreviousEnabled())
          .boolean("seek", caps.IsPlaybackPositionEnabled())
          .boolean("shuffle", caps.IsShuffleEnabled())
          .boolean("repeat", caps.IsRepeatEnabled())
          .endObject();
      s.endObject();
      if (list.size() > 1) list += ',';
      list += s.text();
      const std::string key = to_string(props.Title()) + "\x1f" + to_string(props.Artist()) + "\x1f" + to_string(props.AlbumTitle());
      if (key != t.artKey) {
        t.artKey = key;
        artToSend.emplace_back(&t, props);
      }
      SendApp(app);
    } catch (...) {
      // a session that closed while we read it
    }
  }
  list += ']';
  w.raw("list", list).endObject();
  if (w.text() != g_lastState) {
    g_lastState = w.text();
    Emit(g_lastState);
  }
  for (auto& [t, props] : artToSend) {
    std::string data;
    try {
      if (const auto thumb = props.Thumbnail()) data = DataUrl(thumb.OpenReadAsync().get());
    } catch (...) {
    }
    JsonWriter a;
    a.beginObject().str("t", "art").str("id", t->id).str("key", t->artKey).str("data", data).endObject();
    Emit(a.text());
  }
}

bool AnyPlaying() {
  std::lock_guard lock(g_mu);
  for (const Tracked& t : g_sessions) {
    try {
      if (t.session.GetPlaybackInfo().PlaybackStatus() == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) return true;
    } catch (...) {
    }
  }
  return false;
}

// ---------- volume ----------

struct VolumeWish {
  float level = -1;  // < 0: leave the mixer alone
  std::set<DWORD> roots;
  std::vector<std::wstring> apps;  // exe names, lower case
};
VolumeWish g_volume;
bool g_volumeDirty = false;

std::wstring Lower(std::wstring s) {
  for (wchar_t& c : s) c = static_cast<wchar_t>(towlower(c));
  return s;
}

bool g_volumeReport = false;

// Runs on the main loop's thread (COM is set up there). With a report asked for, also lists every
// session with its process and level (the host logs it).
void ApplyVolume() {
  VolumeWish wish;
  bool report;
  {
    std::lock_guard lock(g_mu);
    report = g_volumeReport;
    g_volumeReport = false;
    if (g_volume.level < 0 && !report) return;
    wish = g_volume;
  }
  // Who started whom, and what each process is.
  std::map<DWORD, std::pair<DWORD, std::wstring>> procs;
  const HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap != INVALID_HANDLE_VALUE) {
    PROCESSENTRY32W pe{sizeof pe};
    for (BOOL ok = Process32FirstW(snap, &pe); ok; ok = Process32NextW(snap, &pe)) {
      procs[pe.th32ProcessID] = {pe.th32ParentProcessID, Lower(pe.szExeFile)};
    }
    CloseHandle(snap);
  }
  const auto wanted = [&](DWORD pid) {
    for (int depth = 0; pid && depth < 12; ++depth) {
      if (wish.roots.count(pid)) return true;
      const auto it = procs.find(pid);
      if (it == procs.end()) break;
      for (const std::wstring& app : wish.apps)
        if (it->second.second == app) return true;
      pid = it->second.first;
    }
    return false;
  };
  try {
    com_ptr<IMMDeviceEnumerator> devices;
    check_hresult(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), devices.put_void()));
    com_ptr<IMMDevice> device;
    check_hresult(devices->GetDefaultAudioEndpoint(eRender, eMultimedia, device.put()));
    com_ptr<IAudioSessionManager2> manager;
    check_hresult(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, manager.put_void()));
    com_ptr<IAudioSessionEnumerator> sessions;
    check_hresult(manager->GetSessionEnumerator(sessions.put()));
    int count = 0;
    sessions->GetCount(&count);
    std::string list;
    for (int i = 0; i < count; ++i) {
      com_ptr<IAudioSessionControl> control;
      if (FAILED(sessions->GetSession(i, control.put()))) continue;
      const auto control2 = control.try_as<IAudioSessionControl2>();
      DWORD pid = 0;
      if (!control2 || FAILED(control2->GetProcessId(&pid))) continue;
      const auto volume = control.try_as<ISimpleAudioVolume>();
      float now = -1;
      if (volume) volume->GetMasterVolume(&now);
      const bool ours = wish.level >= 0 && wanted(pid);
      if (ours && volume && std::fabs(now - wish.level) > 0.002f) {
        volume->SetMasterVolume(wish.level, nullptr);
        now = wish.level;
      }
      if (report) {
        const auto it = procs.find(pid);
        const std::wstring exe = it == procs.end() ? L"" : it->second.second;
        tp::JsonWriter w;
        w.beginObject().integer("pid", pid).str("exe", std::string(exe.begin(), exe.end())).num("level", now, 3).boolean("ours", ours).endObject();
        list += (list.empty() ? "" : ",") + w.text();
      }
    }
    if (report) Emit("{\"t\":\"volumes\",\"list\":[" + list + "]}");
  } catch (...) {
  }
}


// Spotify, started from the car: minimized, so no window comes in front of the game.
bool SpotifyRunning() {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return false;
  PROCESSENTRY32W pe{sizeof pe};
  bool found = false;
  for (BOOL ok = Process32FirstW(snap, &pe); ok && !found; ok = Process32NextW(snap, &pe)) {
    found = _wcsicmp(pe.szExeFile, L"Spotify.exe") == 0;
  }
  CloseHandle(snap);
  return found;
}

GlobalSystemMediaTransportControlsSession SpotifySession() {
  try {
    for (const auto& ss : g_manager.GetSessions()) {
      std::wstring id(ss.SourceAppUserModelId());
      if (Lower(id).find(L"spotify") != std::wstring::npos) return ss;
    }
  } catch (...) {
  }
  return nullptr;
}

// The Store version comes up in a window whatever it is told; it goes down to the taskbar at once,
// without being activated, so the game keeps the screen.
bool MinimizeSpotify() {
  struct Find {
    bool done = false;
  } find;
  EnumWindows(
      [](HWND h, LPARAM lp) -> BOOL {
        auto* f = reinterpret_cast<Find*>(lp);
        if (!IsWindowVisible(h) || IsIconic(h) || GetWindow(h, GW_OWNER) || !GetWindowTextLengthW(h)) return TRUE;
        DWORD pid = 0;
        GetWindowThreadProcessId(h, &pid);
        HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!proc) return TRUE;
        wchar_t path[MAX_PATH];
        DWORD n = MAX_PATH;
        const bool spotify = QueryFullProcessImageNameW(proc, 0, path, &n) && Lower(path).ends_with(L"\\spotify.exe");
        CloseHandle(proc);
        if (spotify) {
          ShowWindow(h, SW_SHOWMINNOACTIVE);
          f->done = true;
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&find));
  return find.done;
}

void LaunchSpotify() {
  init_apartment(apartment_type::multi_threaded);
  std::string how = "none";
  bool ok = false;
  if (SpotifyRunning()) {
    how = "running";
    ok = true;
  } else {
    // The desktop app, from Spotify's own installer.
    wchar_t appdata[MAX_PATH];
    const DWORD n = GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH);
    if (n && n < MAX_PATH) {
      std::wstring exe = std::wstring(appdata) + L"\\Spotify\\Spotify.exe";
      if (GetFileAttributesW(exe.c_str()) != INVALID_FILE_ATTRIBUTES) {
        std::wstring cmd = L"\"" + exe + L"\" --minimized";
        STARTUPINFOW si{sizeof si};
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_SHOWMINNOACTIVE;
        PROCESS_INFORMATION pi{};
        if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi)) {
          CloseHandle(pi.hThread);
          CloseHandle(pi.hProcess);
          how = "desktop";
          ok = true;
        }
      }
    }
    // The Microsoft Store app: activated through Windows, with the same --minimized.
    if (!ok) {
      IApplicationActivationManager* mgr = nullptr;
      if (SUCCEEDED(CoCreateInstance(__uuidof(ApplicationActivationManager), nullptr, CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&mgr)))) {
        DWORD pid = 0;
        if (SUCCEEDED(mgr->ActivateApplication(L"SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", L"--minimized", AO_NOERRORUI, &pid))) {
          how = "store";
          ok = true;
        }
        mgr->Release();
      }
    }
  }
  Emit(std::string(R"({"t":"launched","app":"spotify","ok":)") + (ok ? "true" : "false") + R"(,"how":")" + how + R"("})");
  if (!ok) return;
  // Play on where it left off, once its media session shows up.
  bool minimized = how == "running";
  for (int i = 0; i < 40 && !g_quit; ++i) {
    if (!minimized) minimized = MinimizeSpotify();
    if (auto ss = SpotifySession()) {
      try {
        const auto status = ss.GetPlaybackInfo().PlaybackStatus();
        if (status != GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) ss.TryPlayAsync().get();
      } catch (...) {
      }
      Poke();
      for (int j = 0; j < 15 && !minimized && !g_quit; ++j) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        minimized = MinimizeSpotify();
      }
      return;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
  }
  // Running but with nothing loaded yet: the media key reaches it wherever it is.
  INPUT in[2]{};
  in[0].type = in[1].type = INPUT_KEYBOARD;
  in[0].ki.wVk = in[1].ki.wVk = VK_MEDIA_PLAY_PAUSE;
  in[1].ki.dwFlags = KEYEVENTF_KEYUP;
  SendInput(2, in, sizeof(INPUT));
}

void Command(const std::string& line) {
  const std::string t = tp::JsonString(line, "t");
  if (t == "launch") {
    std::thread(LaunchSpotify).detach();
    return;
  }
  if (t == "volumes") {
    {
      std::lock_guard lock(g_mu);
      g_volumeReport = true;
    }
    Poke();
    return;
  }
  if (t == "volume") {
    VolumeWish wish;
    wish.level = std::clamp(static_cast<float>(tp::JsonNumber(line, "level", -1)), -1.0f, 1.0f);
    for (const double pid : tp::JsonNumbers(line, "pids")) wish.roots.insert(static_cast<DWORD>(pid));
    for (const std::string& app : tp::JsonStrings(line, "apps")) {
      std::wstring w(app.begin(), app.end());
      wish.apps.push_back(Lower(w));
    }
    {
      std::lock_guard lock(g_mu);
      g_volume = std::move(wish);
      g_volumeDirty = true;
    }
    Poke();
    return;
  }
  if (t == "refresh") {
    {
      std::lock_guard lock(g_mu);
      g_lastState.clear();
      for (Tracked& s : g_sessions) s.artKey.clear();
      g_appsSent.clear();
    }
    Poke();
    return;
  }
  if (t != "cmd") return;
  const std::string id = tp::JsonString(line, "id");
  const std::string cmd = tp::JsonString(line, "cmd");
  const double v = tp::JsonNumber(line, "v", 0);
  GlobalSystemMediaTransportControlsSession s{nullptr};
  {
    std::lock_guard lock(g_mu);
    for (const Tracked& tr : g_sessions)
      if (tr.id == id) s = tr.session;
  }
  if (!s) return;
  try {
    if (cmd == "play") s.TryPlayAsync().get();
    else if (cmd == "pause") s.TryPauseAsync().get();
    else if (cmd == "toggle") s.TryTogglePlayPauseAsync().get();
    else if (cmd == "next") s.TrySkipNextAsync().get();
    else if (cmd == "prev") s.TrySkipPreviousAsync().get();
    else if (cmd == "seek") {
      const double start = Seconds(s.GetTimelineProperties().StartTime());
      s.TryChangePlaybackPositionAsync(static_cast<int64_t>((start + v) * 10'000'000.0)).get();
    } else if (cmd == "shuffle") s.TryChangeShuffleActiveAsync(v != 0).get();
    else if (cmd == "repeat") {
      const auto mode = v >= 2 ? Windows::Media::MediaPlaybackAutoRepeatMode::List
                        : v >= 1 ? Windows::Media::MediaPlaybackAutoRepeatMode::Track
                                 : Windows::Media::MediaPlaybackAutoRepeatMode::None;
      s.TryChangeAutoRepeatModeAsync(mode).get();
    }
  } catch (...) {
  }
  Poke();
}

}  // namespace

int main() {
  _setmode(_fileno(stdout), _O_BINARY);
  init_apartment(apartment_type::multi_threaded);
  try {
    g_manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
  } catch (...) {
    Emit("{\"t\":\"error\",\"message\":\"media sessions unavailable\"}");
    return 1;
  }
  g_manager.SessionsChanged([](auto&&, auto&&) { Poke(); });
  g_manager.CurrentSessionChanged([](auto&&, auto&&) { Poke(); });

  std::thread input([] {
    std::string line;
    while (std::getline(std::cin, line)) {
      if (!line.empty() && line.back() == '\r') line.pop_back();
      if (!line.empty()) Command(line);
    }
    g_quit = true;  // the host went away
    g_wake.notify_one();
  });

  std::mutex waitMu;
  while (!g_quit) {
    {
      std::unique_lock lock(waitMu);
      // Events wake us at once; while something plays, a slow poll keeps the clock honest
      // (some players report their position only now and then).
      g_wake.wait_for(lock, std::chrono::milliseconds(AnyPlaying() ? 1000 : 3000), [] { return g_dirty || g_quit; });
    }
    if (g_quit) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(40));  // let a burst of events settle
    g_dirty = false;
    try {
      Publish();
    } catch (...) {
    }
    ApplyVolume();
  }
  input.detach();
  return 0;
}
