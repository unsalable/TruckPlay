#include "pointer.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <mutex>
#include <vector>

#include "json.h"
#include "log.h"

namespace tp::pointer {
namespace {

enum Kind { kPlate = 1, kLift = 2, kText = 3 };

struct Target {
  float x, y, w, h, r;
  int kind;
};

// Apple-style spring from perceived duration and bounce, converted the way Motion does, so the
// plugin's pointer moves with the same feel as the UI's springs.
struct Spring {
  float k = 0, c = 0, x = 0, v = 0;
  Spring(float duration, float bounce, float start) : x(start) {
    const float root = 6.2831853f / (duration * 1.2f);
    k = root * root;
    c = 2.0f * std::clamp(1.0f - bounce, 0.05f, 1.0f) * root;
  }
  void Step(float target, float dt) {
    const int steps = std::max(1, static_cast<int>(std::ceil(dt / 0.004f)));
    const float h = dt / static_cast<float>(steps);
    for (int i = 0; i < steps; ++i) {
      v += (k * (target - x) - c * v) * h;
      x += v * h;
    }
  }
  void Snap(float value) {
    x = value;
    v = 0;
  }
};

std::mutex g_mu;
std::vector<Target> g_targets;
float g_disc = 28.0f, g_pad = 7.0f, g_lean = 0.12f;
float g_fx = 0, g_fy = 0, g_fw = 0, g_fh = 0;
bool g_haveFrame = false;
float g_beamH = 14.0f;

// Presence and press are snappy; the plate travels like the UI's spring.pointer.
Spring g_visible(0.32f, 0.12f, 0), g_press(0.3f, 0.12f, 1), g_ring(0.24f, 0, 0), g_text(0.22f, 0, 0);
Spring g_morph(0.22f, 0.06f, 0);
Spring g_px(0.16f, 0.18f, 0), g_py(0.16f, 0.18f, 0), g_pw(0.16f, 0.18f, 0), g_ph(0.16f, 0.18f, 0),
    g_pr(0.16f, 0.18f, 0);

float Lerp(float a, float b, float t) { return a + (b - a) * t; }

std::vector<float> Numbers(const std::string& json, const char* key) {
  std::vector<float> out;
  const char* p = JsonFind(json, key);
  if (!p || *p != '[') return out;
  for (++p; *p && *p != ']';) {
    char* end = nullptr;
    const double v = strtod(p, &end);
    if (end == p) {
      ++p;
      continue;
    }
    out.push_back(static_cast<float>(v));
    p = end;
  }
  return out;
}

}  // namespace

void Configure(const std::string& cfg) {
  if (!JsonFind(cfg, "fw") || !JsonFind(cfg, "fh")) return;
  std::lock_guard lock(g_mu);
  g_fx = static_cast<float>(JsonNumber(cfg, "fx", 0));
  g_fy = static_cast<float>(JsonNumber(cfg, "fy", 0));
  g_fw = static_cast<float>(JsonNumber(cfg, "fw", 0));
  g_fh = static_cast<float>(JsonNumber(cfg, "fh", 0));
  g_haveFrame = g_fw > 1 && g_fh > 1;
  TPLOG("pointer: UI area %.0f,%.0f %.0fx%.0f", g_fx, g_fy, g_fw, g_fh);
}

void SetTargets(const std::string& json) {
  const std::vector<float> list = Numbers(json, "list");
  std::lock_guard lock(g_mu);
  g_disc = std::clamp(static_cast<float>(JsonNumber(json, "d", g_disc)), 4.0f, 120.0f);
  g_pad = std::clamp(static_cast<float>(JsonNumber(json, "pad", g_pad)), 0.0f, 40.0f);
  g_lean = std::clamp(static_cast<float>(JsonNumber(json, "lean", g_lean)), 0.0f, 0.5f);
  g_targets.clear();
  for (size_t i = 0; i + 5 < list.size(); i += 6) {
    const Target t{list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4], static_cast<int>(list[i + 5])};
    if (t.w > 0 && t.h > 0 && t.kind >= kPlate && t.kind <= kText) g_targets.push_back(t);
  }
}

bool HasFrame() {
  std::lock_guard lock(g_mu);
  return g_haveFrame;
}

Shape Update(float dt, bool interacting, float nx, float ny, bool pressed) {
  std::lock_guard lock(g_mu);
  if (!g_haveFrame) return {};
  const float px = g_fx + nx * std::max(0.0f, g_fw - 1) + 0.5f;
  const float py = g_fy + ny * std::max(0.0f, g_fh - 1) + 0.5f;

  // The innermost target under the pointer wins (a button inside a card). App icons answer a
  // little beyond their artwork, as the UI's own hover does.
  const Target* hit = nullptr;
  if (interacting) {
    float best = 3.4e38f;
    for (const Target& t : g_targets) {
      const float m = t.kind == kLift ? g_pad * 0.8f : 0.0f;
      if (px < t.x - m || py < t.y - m || px >= t.x + t.w + m || py >= t.y + t.h + m) continue;
      const float area = t.w * t.h;
      if (area < best) {
        best = area;
        hit = &t;
      }
    }
  }
  const int kind = hit ? hit->kind : 0;

  g_visible.Step(interacting ? 1.0f : 0.0f, dt);
  g_press.Step(pressed && interacting ? 0.86f : 1.0f, dt);
  g_ring.Step(kind == kLift ? 1.0f : 0.0f, dt);
  g_text.Step(kind == kText ? 1.0f : 0.0f, dt);
  if (kind == kText) g_beamH = std::clamp(hit->h * 0.36f, 6.0f, g_disc * 0.7f);

  if (kind == kPlate || kind == kLift) {
    // A plate around a button, or a focus ring around an app icon; both lean a little toward
    // the pointer (magnetism) and slide from one target to the next.
    const bool icon = kind == kLift;
    const float lean = icon ? g_lean * 0.5f : g_lean;
    const float pad = icon ? g_pad * 0.6f : g_pad;
    const float cx = hit->x + hit->w * 0.5f, cy = hit->y + hit->h * 0.5f;
    const float tx = cx + (px - cx) * lean, ty = cy + (py - cy) * lean;
    const float tw = hit->w * 0.5f + pad, th = hit->h * 0.5f + pad;
    const float tr = std::min(hit->r + pad, std::min(tw, th));
    if (g_morph.x < 0.04f) {
      // Coming from the free disc: the plate appears in place and the morph carries the disc into it.
      g_px.Snap(tx);
      g_py.Snap(ty);
      g_pw.Snap(tw);
      g_ph.Snap(th);
      g_pr.Snap(tr);
    } else {
      // Plate to plate: it slides over to the next button.
      g_px.Step(tx, dt);
      g_py.Step(ty, dt);
      g_pw.Step(tw, dt);
      g_ph.Step(th, dt);
      g_pr.Step(tr, dt);
    }
    g_morph.Step(1.0f, dt);
  } else {
    g_morph.Step(0.0f, dt);
  }

  // Free pointer: the disc sits exactly on the mouse position, no smoothing.
  const float d = g_disc * 0.5f;
  const float beamW = std::max(1.3f, g_disc * 0.075f);
  const float text = std::clamp(g_text.x, 0.0f, 1.0f);
  float cx = px, cy = py;
  float hw = Lerp(d, beamW, text), hh = Lerp(d, g_beamH, text), r = Lerp(d, beamW, text);

  const float m = std::clamp(g_morph.x, 0.0f, 1.0f);
  cx = Lerp(cx, g_px.x, m);
  cy = Lerp(cy, g_py.x, m);
  hw = Lerp(hw, std::max(1.0f, g_pw.x), m);
  hh = Lerp(hh, std::max(1.0f, g_ph.x), m);
  r = Lerp(r, std::max(0.0f, g_pr.x), m);

  // A press pushes the shape in a little (a ring less, it hugs its icon).
  const float ring = std::clamp(g_ring.x, 0.0f, 1.0f);
  const float scale = 1.0f - (1.0f - std::max(0.2f, g_press.x)) * (1.0f - 0.6f * ring);
  hw *= scale;
  hh *= scale;
  r = std::min(r * scale, std::min(hw, hh));
  const float alpha = std::clamp(g_visible.x, 0.0f, 1.0f);

  if (!interacting && g_visible.x < 0.003f) {
    // Fully gone: settle everything so the next appearance starts from a plain disc.
    g_visible.Snap(0);
    g_morph.Snap(0);
    g_ring.Snap(0);
    g_text.Snap(0);
    g_press.Snap(1);
    return {cx, cy, hw, hh, r, 0, 0};
  }
  return {cx, cy, hw, hh, r, alpha < 0.004f ? 0.0f : alpha, ring};
}

}  // namespace tp::pointer
