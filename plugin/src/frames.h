#pragma once
#include <cstdint>

namespace tp::frames {

// Layout documented in shared/protocol.md.
struct BufInfo {
  uint32_t width, height, stride;
  uint32_t dirtyX, dirtyY, dirtyW, dirtyH;  // region that changed since the previous frame (seq - 1)
  uint32_t pad;
};
struct Header {
  uint32_t magic;
  uint32_t version;
  uint32_t front;
  uint32_t flags;  // bit 0: host alive; bit 1: draw it (the HUD's channel)
  uint64_t seq;
  uint64_t hostPid;
  BufInfo buf[2];
  uint8_t reserved[32];
};
static_assert(sizeof(Header) == 128);

constexpr uint32_t kMagic = 0x31465054;  // 'TPF1'
constexpr uint32_t kHeaderBytes = 128;
constexpr uint32_t kMaxW = 2048, kMaxH = 1600;

struct Frame {
  const uint8_t* pixels = nullptr;
  uint32_t width = 0, height = 0, stride = 0;
  uint32_t dirtyX = 0, dirtyY = 0, dirtyW = 0, dirtyH = 0;
  uint64_t seq = 0;
};

// One channel of frames the host writes into shared memory: the cab screen's, or the HUD's.
class Channel {
 public:
  // `name` in the game; under TRUCKPLAY_SHM (the test cab) that name plus `testSuffix`.
  Channel(const wchar_t* name, const wchar_t* testSuffix, uint32_t maxW, uint32_t maxH);
  bool Open();
  void Close();
  // A frame newer than `lastSeq`, if the host published one.
  bool Latest(uint64_t lastSeq, Frame* out);
  // True if the frame read via Latest() was not overwritten while it was being copied.
  bool StillIntact(const Frame& f) const;
  bool HostAlive() const;
  bool Visible() const;

 private:
  Header* Hdr() const { return reinterpret_cast<Header*>(base_); }
  uint64_t LoadSeq() const;

  const wchar_t* name_;
  const wchar_t* testSuffix_;
  uint32_t maxW_, maxH_;
  uint64_t bufBytes_, totalBytes_;
  void* map_ = nullptr;
  uint8_t* base_ = nullptr;
  bool failed_ = false;
};

Channel& Screen();  // the cab screen
Channel& Hud();     // the HUD over the road
Channel& Wind();    // the HUD in the windshield

// The cab screen's channel, as its callers know it.
inline bool Open() { return Screen().Open(); }
inline void Close() { Screen().Close(); }
inline bool Latest(uint64_t lastSeq, Frame* out) { return Screen().Latest(lastSeq, out); }
inline bool StillIntact(const Frame& f) { return Screen().StillIntact(f); }
inline bool HostAlive() { return Screen().HostAlive(); }

}  // namespace tp::frames
