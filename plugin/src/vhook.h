#pragma once
// Function-pointer swaps in COM vtables and import tables. No code patching: every object of
// the class (including ones created before we loaded) goes through the replacement.

#include <windows.h>

namespace tp {

struct VHook {
  void** slot = nullptr;
  void* original = nullptr;
  void* replacement = nullptr;
};

inline bool SwapPointer(void** slot, void* value, void** previous) {
  DWORD old;
  if (!VirtualProtect(slot, sizeof(void*), PAGE_READWRITE, &old)) return false;
  if (previous) *previous = *slot;
  *slot = value;
  VirtualProtect(slot, sizeof(void*), old, &old);
  return true;
}

inline bool PatchVtable(void** vtable, int index, void* replacement, VHook& hook) {
  if (hook.slot) return true;  // already installed
  void** slot = &vtable[index];
  if (*slot == replacement) return true;
  if (!SwapPointer(slot, replacement, &hook.original)) return false;
  hook.slot = slot;
  hook.replacement = replacement;
  return true;
}

// Restores the original only if nobody chained on top of us since.
inline void UnpatchVtable(VHook& hook) {
  if (!hook.slot) return;
  if (*hook.slot == hook.replacement) SwapPointer(hook.slot, hook.original, nullptr);
  hook.slot = nullptr;
}

// Replaces `module`'s import of dll!name. Returns the slot, or nullptr if not imported.
inline void** FindImport(HMODULE module, const char* dll, const char* name) {
  auto* base = reinterpret_cast<BYTE*>(module);
  auto* dos = reinterpret_cast<IMAGE_DOS_HEADER*>(base);
  auto* nt = reinterpret_cast<IMAGE_NT_HEADERS*>(base + dos->e_lfanew);
  const IMAGE_DATA_DIRECTORY& dir = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  if (!dir.VirtualAddress) return nullptr;
  for (auto* imp = reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(base + dir.VirtualAddress); imp->Name; ++imp) {
    if (_stricmp(reinterpret_cast<const char*>(base + imp->Name), dll) != 0) continue;
    auto* names = reinterpret_cast<IMAGE_THUNK_DATA*>(base + (imp->OriginalFirstThunk ? imp->OriginalFirstThunk : imp->FirstThunk));
    auto* funcs = reinterpret_cast<IMAGE_THUNK_DATA*>(base + imp->FirstThunk);
    for (; names->u1.AddressOfData; ++names, ++funcs) {
      if (IMAGE_SNAP_BY_ORDINAL(names->u1.Ordinal)) continue;
      auto* byName = reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(base + names->u1.AddressOfData);
      if (!strcmp(reinterpret_cast<const char*>(byName->Name), name)) return reinterpret_cast<void**>(&funcs->u1.Function);
    }
  }
  return nullptr;
}

}  // namespace tp
