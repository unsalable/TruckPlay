#pragma once
#include <string>

namespace tp::pointer {

// The iPadOS-style pointer, drawn by the plugin straight into the screen texture so it follows the
// mouse on the very next game frame instead of waiting for the UI's frame to come back. The UI
// tells us where its buttons are; hovering one morphs the disc into a plate around it, app icons
// get a focus ring (CarPlay's, so the choice reads from the driver's seat), text fields turn it
// into an I-beam.

struct Shape {
  float cx, cy;  // centre, marker-texture pixels
  float hw, hh;  // half extents
  float radius;
  float alpha;  // 0 = nothing to draw
  float ring;   // 0 = filled disc/plate … 1 = focus ring around the shape
};

// UI area inside the texture (from the host's cfg: fx, fy, fw, fh). Ignored when absent.
void Configure(const std::string& cfgJson);
// {"t":"targets","d":disc,"pad":plate padding,"lean":magnetism,"list":[x,y,w,h,r,kind,…]}
void SetTargets(const std::string& json);
// Advances the springs one frame. nx, ny: pointer position, 0–1 across the UI area.
Shape Update(float dt, bool interacting, float nx, float ny, bool pressed);
bool HasFrame();

}  // namespace tp::pointer
