#pragma once
#include <string>

namespace tp::d3d {

constexpr unsigned kMarkerWidth = 1282;
// The route advisor's TruckPlay panel (mod/build-mod.mjs adds it to ui/adviser_gps.sii): its
// marker texture's size, unlike any cab screen's, and the panel's proportions on the screen.
constexpr unsigned kAdvisorWidth = 642, kAdvisorHeight = 361;
constexpr float kAdvisorAspect = 270.0f / 152.0f;

// Patches the shared DXGI swap chain / D3D11 device vtables (via a throwaway device).
bool Install();
void Uninstall();
// `screen` message describing the newest live marker texture (w = 0 when none).
std::string ScreenJson();
// `view` message: the size of the game's picture (0 x 0 before the first frame).
std::string ViewJson();
// Where the HUD goes: near the top of the picture (default) or above its bottom edge.
void SetHudBottom(bool bottom);
// The windshield HUD: shown (in the cab view) or not, and how far below the line of sight its
// image sits, in degrees.
void SetWind(bool on, float dropDegrees);
// The route advisor's panel: a copy of the cab screen, or clear.
void SetAdvisor(bool on);

}  // namespace tp::d3d
