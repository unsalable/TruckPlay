#pragma once
#include <d3d11.h>
#include <dxgi.h>

#include "pointer.h"

namespace tp::overlay {

// A rectangle of the frame, in its pixels.
struct Rect {
  float x, y, w, h;
};

// The big 2D view: the current frame as a rounded panel over the dimmed game.
bool Init(ID3D11Device* device);
void Shutdown();
void ReleaseTarget();  // before the swap chain resizes
// srv[0] = UNORM view, srv[1] = UNORM_SRGB view of the frame; `src` the part of it shown (the cab
// screen's, when the frame also holds the F3 panel's); `open` is the 0…1 spring value.
void Draw(IDXGISwapChain* sc, ID3D11DeviceContext* ctx, ID3D11ShaderResourceView* const srv[2], unsigned frameW,
          unsigned frameH, const Rect& src, float open);

// The part `src` of the composed frame (frameW x frameH, srv as for Draw) into `target`, a texture of
// targetW x targetH the game shows stretched over a panel of `panelAspect`: fitted at its own
// proportions, centred, its corners rounded by `radius` texture pixels; around it `fill` (straight
// alpha) lit by the picture's own colours near its edges (`glow` 0…1), the whole panel's corners
// rounded by `panelRadius`. `srgbTarget`: the target view encodes sRGB.
void DrawFit(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* target, unsigned targetW, unsigned targetH, bool srgbTarget,
             ID3D11ShaderResourceView* const srv[2], unsigned frameW, unsigned frameH, const Rect& src, float panelAspect,
             float radius, float panelRadius, const float fill[4], float glow, float opacity);

// Draws the pointer into `target` (a UNORM view of the composed frame) over the pixels of `base`
// (the clean UI frame), covering exactly `box`. Pixels in the box outside the shape are copied
// from `base`, so the box needs no separate restore.
void DrawPointer(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* target, ID3D11ShaderResourceView* base,
                 const D3D11_BOX& box, const pointer::Shape& shape, float ringWidth);

}  // namespace tp::overlay
