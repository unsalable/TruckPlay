#pragma once
#include <string>

namespace tp::d3d {

constexpr unsigned kMarkerWidth = 1282;
// The route advisor's TruckPlay panel (mod/build-mod.mjs lays it over the advisor's own panel in
// ui/adviser_gps.sii): its marker texture's size, unlike any cab screen's, and the panel's
// proportions on the screen (the advisor panel's, 280 x 244).
constexpr unsigned kAdvisorWidth = 642, kAdvisorHeight = 559;
constexpr float kAdvisorAspect = 280.0f / 244.0f;

// Patches the shared DXGI swap chain / D3D11 device vtables (via a throwaway device).
bool Install();
void Uninstall();
// `screen` message describing the newest live marker texture (w = 0 when none).
std::string ScreenJson();
// `view` message: the size of the game's picture (0 x 0 before the first frame).
std::string ViewJson();
// The route advisor's panel: a copy of the cab screen, or clear.
void SetAdvisor(bool on);

}  // namespace tp::d3d
