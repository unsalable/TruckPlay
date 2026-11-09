#pragma once
#include <windows.h>

#include <string>

namespace tp::input {

// Hold key (default G): while held, the mouse drives a pointer on the in-cab screen instead of the camera.
// Zoom key (default Y, "yaklaş"): toggles the big 2D view, which is interactive while open.
void Attach(HWND gameWindow);
void Detach();
void InstallDeviceHooks();  // DirectInput8 + GetRawInputBuffer, in case the game reads the mouse that way
void RemoveDeviceHooks();

void OnFrame(float dt);  // render thread, once per Present
void Configure(const std::string& cfgJson);
void SetTyping(bool on);
void SetBig(bool on);
// The UI saw the truck being driven again: the pause menu is closed whatever Esc said.
void SetMenu(bool open);
bool MenuOpen();  // the game's Esc menu, as far as we can tell
void SetScreenAspect(float aspect);
// Split screen: the F3 panel's part lies right of the screen's, so the pointer may go on past its
// right edge up to `xMax` (in widths of the screen's part), between `top` and `bottom` (in its
// heights). xMax 1: no such part.
void SetSplitArea(float xMax, float top, float bottom);

bool Interacting();
float BigAmount();  // 0 closed … 1 open, spring-animated
std::string StatsJson();

// The pointer as of now (0–1 across the UI area) for drawing it this frame.
struct PointerState {
  float x, y;
  bool interacting, pressed;
};
PointerState Pointer();
// Test hooks: drive the pointer without a mouse (hooktest, testcab scripts).
void ForcePointer(bool on, float x, float y, bool pressed);
void ForceWheel(int delta);

}  // namespace tp::input
