#pragma once
#include <d3d11.h>
#include <dxgi.h>

#include "pointer.h"

namespace tp::overlay {

// The big 2D view: the current frame as a rounded panel over the dimmed game.
bool Init(ID3D11Device* device);
void Shutdown();
void ReleaseTarget();  // before the swap chain resizes
// srv[0] = UNORM view, srv[1] = UNORM_SRGB view of the frame; `open` is the 0…1 spring value.
void Draw(IDXGISwapChain* sc, ID3D11DeviceContext* ctx, ID3D11ShaderResourceView* const srv[2], unsigned frameW,
          unsigned frameH, float open);

// The HUD over the road: the host's HUD frame (premultiplied BGRA, w x h), centred near the top
// of the picture or above its bottom edge. srv as for Draw.
void DrawHud(IDXGISwapChain* sc, ID3D11DeviceContext* ctx, ID3D11ShaderResourceView* const srv[2], unsigned w, unsigned h,
             bool bottom, float opacity);

// A host layer (premultiplied BGRA, w x h) centred on (cx, cy) of the game's picture, scaled.
void DrawLayer(IDXGISwapChain* sc, ID3D11DeviceContext* ctx, ID3D11ShaderResourceView* const srv[2], unsigned w, unsigned h,
               float cx, float cy, float scale, float opacity);

// The composed frame (srcW x srcH, srv as for Draw) into `target`, a texture of targetW x targetH
// the game shows stretched over a panel of `panelAspect`: fitted at the frame's own proportions,
// centred, corners rounded by `radius` texture pixels, the rest transparent. `srgbTarget`: the
// target view encodes sRGB.
void DrawFit(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* target, unsigned targetW, unsigned targetH, bool srgbTarget,
             ID3D11ShaderResourceView* const srv[2], unsigned srcW, unsigned srcH, float panelAspect, float radius,
             float opacity);

// Draws the pointer into `target` (a UNORM view of the composed frame) over the pixels of `base`
// (the clean UI frame), covering exactly `box`. Pixels in the box outside the shape are copied
// from `base`, so the box needs no separate restore.
void DrawPointer(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* target, ID3D11ShaderResourceView* base,
                 const D3D11_BOX& box, const pointer::Shape& shape, float ringWidth);

}  // namespace tp::overlay
