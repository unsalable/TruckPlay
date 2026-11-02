// seticon <program.exe> <icon.ico>: gives a program the icon's images in place of its own (every
// icon group it has, in each group's language). Used on TruckPlay.exe, which is Electron's program
// renamed, so the taskbar, shortcuts and the game's folder show TruckPlay's icon.

#include <windows.h>

#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

namespace {

#pragma pack(push, 2)
struct GroupEntry {
  BYTE width, height, colors, reserved;
  WORD planes, bits;
  DWORD bytes;
  WORD id;
};
#pragma pack(pop)

struct Group {
  std::wstring name;  // "#123" for numeric ids
  WORD lang;
};

LPCWSTR ResName(const std::wstring& n) { return n[0] == L'#' ? MAKEINTRESOURCEW(_wtoi(n.c_str() + 1)) : n.c_str(); }

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc < 3) {
    fwprintf(stderr, L"usage: seticon <program.exe> <icon.ico>\n");
    return 2;
  }
  std::ifstream f(argv[2], std::ios::binary);
  const std::vector<char> ico((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  if (ico.size() < 6) return 3;
  const WORD count = *reinterpret_cast<const WORD*>(&ico[4]);

  // The program's own icon groups and their languages.
  std::vector<Group> groups;
  if (const HMODULE mod = LoadLibraryExW(argv[1], nullptr, LOAD_LIBRARY_AS_DATAFILE)) {
    EnumResourceNamesW(
        mod, RT_GROUP_ICON,
        [](HMODULE, LPCWSTR, LPWSTR name, LONG_PTR p) -> BOOL {
          auto* out = reinterpret_cast<std::vector<Group>*>(p);
          out->push_back({IS_INTRESOURCE(name) ? L"#" + std::to_wstring(reinterpret_cast<ULONG_PTR>(name)) : std::wstring(name), 0});
          return TRUE;
        },
        reinterpret_cast<LONG_PTR>(&groups));
    for (Group& g : groups) {
      std::vector<WORD> langs;
      EnumResourceLanguagesW(
          mod, RT_GROUP_ICON, ResName(g.name),
          [](HMODULE, LPCWSTR, LPCWSTR, WORD lang, LONG_PTR q) -> BOOL {
            reinterpret_cast<std::vector<WORD>*>(q)->push_back(lang);
            return TRUE;
          },
          reinterpret_cast<LONG_PTR>(&langs));
      g.lang = langs.empty() ? MAKELANGID(LANG_NEUTRAL, SUBLANG_NEUTRAL) : langs[0];
    }
    FreeLibrary(mod);
  }
  if (groups.empty()) groups.push_back({L"#1", MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US)});

  const HANDLE h = BeginUpdateResourceW(argv[1], FALSE);
  if (!h) {
    fwprintf(stderr, L"cannot open %ls for update (%lu)\n", argv[1], GetLastError());
    return 4;
  }
  std::vector<char> group(6 + sizeof(GroupEntry) * count);
  memcpy(group.data(), ico.data(), 6);
  for (WORD i = 0; i < count; ++i) {
    const char* e = &ico[6 + i * 16];
    const DWORD bytes = *reinterpret_cast<const DWORD*>(e + 8);
    const DWORD offset = *reinterpret_cast<const DWORD*>(e + 12);
    const WORD id = static_cast<WORD>(900 + i);
    GroupEntry g{static_cast<BYTE>(e[0]), static_cast<BYTE>(e[1]), static_cast<BYTE>(e[2]), 0,
                 *reinterpret_cast<const WORD*>(e + 4), *reinterpret_cast<const WORD*>(e + 6), bytes, id};
    memcpy(&group[6 + i * sizeof(GroupEntry)], &g, sizeof g);
    for (const Group& gr : groups) {
      UpdateResourceW(h, RT_ICON, MAKEINTRESOURCEW(id), gr.lang, const_cast<char*>(&ico[offset]), bytes);
    }
  }
  for (const Group& gr : groups) {
    UpdateResourceW(h, RT_GROUP_ICON, ResName(gr.name), gr.lang, group.data(), static_cast<DWORD>(group.size()));
  }
  if (!EndUpdateResourceW(h, FALSE)) {
    fwprintf(stderr, L"update failed (%lu)\n", GetLastError());
    return 5;
  }
  wprintf(L"icon set on %ls (%zu group(s))\n", argv[1], groups.size());
  return 0;
}
