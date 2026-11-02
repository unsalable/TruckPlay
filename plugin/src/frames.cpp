#include "frames.h"

#include <windows.h>

#include <atomic>
#include <cwchar>

#include "log.h"

namespace tp::frames {

Channel::Channel(const wchar_t* name, const wchar_t* testSuffix, uint32_t maxW, uint32_t maxH)
    : name_(name),
      testSuffix_(testSuffix),
      maxW_(maxW),
      maxH_(maxH),
      bufBytes_(uint64_t(maxW) * maxH * 4),
      totalBytes_(kHeaderBytes + 2 * uint64_t(maxW) * maxH * 4) {}

uint64_t Channel::LoadSeq() const {
  std::atomic_thread_fence(std::memory_order_acquire);
  return *reinterpret_cast<volatile uint64_t*>(&Hdr()->seq);
}

bool Channel::Open() {
  if (base_) return true;
  if (failed_) return false;
  // TRUCKPLAY_SHM lets the test cab run beside a live game without sharing its frames.
  wchar_t name[128];
  wchar_t custom[96];
  if (GetEnvironmentVariableW(L"TRUCKPLAY_SHM", custom, 96) - 1 < 95) {
    swprintf_s(name, L"Local\\%s%s", custom, testSuffix_);
  } else {
    swprintf_s(name, L"Local\\%s", name_);
  }
  HANDLE map = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, static_cast<DWORD>(totalBytes_ >> 32),
                                  static_cast<DWORD>(totalBytes_ & 0xffffffff), name);
  if (!map) {
    TPLOG("frames %ls: CreateFileMapping failed (%lu)", name, GetLastError());
    failed_ = true;
    return false;
  }
  base_ = static_cast<uint8_t*>(MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, 0));
  if (!base_) {
    TPLOG("frames %ls: MapViewOfFile failed (%lu)", name, GetLastError());
    CloseHandle(map);
    failed_ = true;
    return false;
  }
  map_ = map;
  if (Hdr()->magic != kMagic) {
    // We created it: stamp the header so the host recognises the layout.
    Hdr()->version = 1;
    Hdr()->magic = kMagic;
  }
  TPLOG("frames %ls: shared memory ready (%llu MB)", name, totalBytes_ >> 20);
  return true;
}

void Channel::Close() {
  if (base_) UnmapViewOfFile(base_);
  if (map_) CloseHandle(static_cast<HANDLE>(map_));
  base_ = nullptr;
  map_ = nullptr;
}

bool Channel::Latest(uint64_t lastSeq, Frame* out) {
  if (!base_ || Hdr()->magic != kMagic) return false;
  const uint64_t seq = LoadSeq();
  if (seq == lastSeq || seq == 0) return false;
  const uint32_t front = Hdr()->front & 1;
  const BufInfo info = Hdr()->buf[front];
  if (!info.width || !info.height || info.width > maxW_ || info.height > maxH_ || info.stride < info.width * 4) return false;
  out->pixels = base_ + kHeaderBytes + front * bufBytes_;
  out->width = info.width;
  out->height = info.height;
  out->stride = info.stride;
  // A dirty rect only describes the step from seq-1; anything else needs the whole frame.
  const bool consecutive = seq == lastSeq + 1;
  const bool rectOk = info.dirtyW && info.dirtyH && info.dirtyX + info.dirtyW <= info.width &&
                      info.dirtyY + info.dirtyH <= info.height;
  if (consecutive && rectOk) {
    out->dirtyX = info.dirtyX;
    out->dirtyY = info.dirtyY;
    out->dirtyW = info.dirtyW;
    out->dirtyH = info.dirtyH;
  } else {
    out->dirtyX = out->dirtyY = 0;
    out->dirtyW = info.width;
    out->dirtyH = info.height;
  }
  out->seq = seq;
  return true;
}

bool Channel::StillIntact(const Frame& f) const { return LoadSeq() < f.seq + 2; }

bool Channel::HostAlive() const { return base_ && (Hdr()->flags & 1) != 0; }

bool Channel::Visible() const { return base_ && (Hdr()->flags & 3) == 3; }

Channel& Screen() {
  static Channel c(L"TruckPlayFrames", L"", kMaxW, kMaxH);
  return c;
}

Channel& Hud() {
  static Channel c(L"TruckPlayHud", L"Hud", 2048, 800);
  return c;
}

Channel& Wind() {
  static Channel c(L"TruckPlayWind", L"Wind", 1600, 800);
  return c;
}

}  // namespace tp::frames
