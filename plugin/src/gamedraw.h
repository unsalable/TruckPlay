#pragma once
#include <d3d11.h>

#include <string>

// What the game draws, as far as TruckPlay cares: whether the cab is on screen (the windshield
// HUD shows only there), and the game's own GPS map, which TruckPlay's Maps shows instead of a map
// of its own.
//
// The game's GPS script draws the navigation map as an image of a texture the game renders the
// map into ("bare map": /material/ui/dashboard/bare_map.mat). TruckPlay's GPS scripts draw that
// image right beneath the marker texture, into the cab screen's render target. So when the marker
// is bound, the texture bound just before it, into the same target, is the game's map: it is copied
// then. And the cab is in view while the game samples that render target (the cab's screen).
//
// The game creates many views on the fly, so views are known by the resource they were created
// for (recorded as they are created), not by the view pointers seen once.
namespace tp::gamedraw {

// From the device and context hooks. Views are created on any thread; the binds come from the
// game's render thread on its immediate context.
void OnViewCreated(ID3D11Resource* res, ID3D11ShaderResourceView* srv);
void OnRenderTargets(ID3D11DeviceContext* ctx, ID3D11RenderTargetView* rtv);
void OnShaderResources(ID3D11DeviceContext* ctx, UINT start, UINT count, ID3D11ShaderResourceView* const* views);

// The cab screen markers' textures (up to 8), whenever they change.
void SetMarkers(ID3D11Resource* const* textures, unsigned count);

// The game's device and immediate context (first Present).
void Init(ID3D11Device* device, ID3D11DeviceContext* ctx);
void Shutdown();

// The cab was drawn (its screen sampled) within the last quarter second.
bool CabInView();

// The map feed for the host: the game's whole map texture, its colour straight and its alpha kept,
// sent through shared memory (`Local\TruckPlayMap`, see shared/protocol.md) up to 30 times a second
// while asked. `premul`: the game's map holds premultiplied colour (undone for the feed).
void SetFeed(bool on, bool premul);
// In Present: copies the newest map into the feed when it is due. Returns a `mapfeed` status
// message when the map has come or gone, else an empty string.
std::string ProduceFeed();

// The `mapfeed` status message as things stand (for a host that has just connected).
std::string Status();

// One line for the log: what the plugin sees of the game's drawing.
std::string Diagnostics();

}  // namespace tp::gamedraw
