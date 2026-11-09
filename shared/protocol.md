# TruckPlay plugin ↔ host protocol

Two channels connect `truckplay.dll` (inside `eurotrucks2.exe`) and the TruckPlay host (Electron).

## 1. Named pipe `\\.\pipe\tirplay`

The plugin is the server; the host connects (and reconnects every second when the game is not running).
Messages are UTF-8 JSON objects, one per line (`\n`). Every message has a `t` (type) field.

### plugin → host

| t | when | fields |
|---|---|---|
| `hello` | on connect | `plugin` (version), `game` (`eut2`), `sdk` (telemetry game version, e.g. `1.21`), `gameVersion` (the game exe's product version, e.g. `1.62.1`), `gameDir` (the game's folder), `pointer` (true: the plugin draws the pointer itself). When `gameVersion`'s major.minor differs from the one the installed mod was built for (`shared/screens.json` `gameVersion`), the host rebuilds the mod from `gameDir` (host/src/modcheck.js) and tells the UI (`ev` `truckplay.mod`) |
| `tel` | 20 Hz | `paused`, `game{time,rest,brk,scale,mp}`, `truck{…}`, `trailer{…}`, `job{…}` — see `telemetry.cpp` |
| `ev` | gameplay event | `id` (e.g. `player.fined`), `a` (attributes object) |
| `screen` | a marker texture was created (player got into a truck) | `w`, `h`, `fmt`. Any BGRA texture 1282 px wide is a marker: the mod gives each measured cab screen its own height (`shared/screens.json`); 1282×1282 is the generic script's |
| `ptr` | pointer while interacting | `act` (`enter`/`leave`/`move`/`down`/`up`/`wheel`), `x`,`y` (0–1 across the cab screen's part, top-left origin; in split screen `x` goes on past 1 into the F3 panel's part, up to `(panel.x + panel.w) / main.w`, beside the panel's rows only), `b`, `dy` |
| `key` | keyboard while typing | `act` (`down`/`up`/`char`), `vk` or `ch` |
| `mode` | big-screen toggle | `big` (bool) |
| `stats` | every 5 s | input diagnostics (`wmInput`, `diMouse`, `fps`, `uploads`, …) |
| `eval` | test cab only | `js` — the host (started with `--profile`) runs it in the UI |
| `menu` | Esc pressed while not typing and not in the big view | `open` (bool) — the plugin's guess at the game's Esc menu. It toggles on every Esc, so it can drift; the UI corrects it (see `menu` below) |
| `view` | on connect, and when the game's picture changes size | `w`, `h` — the swap chain's size (0 before the first frame) |
| `mapfeed` | on connect, and when the game's map comes or goes, or stops or starts being drawn anew | `ready` (bool: the plugin has seen the game draw its GPS map in the last 3 s), `fresh` (bool: the game still draws the map itself anew; false with an outside camera, when it only shows its last picture), `w`, `h` (the game's map texture) |

### host → plugin

| t | fields |
|---|---|
| `hello` | `host` (version) |
| `cfg` | `holdVk`, `zoomVk`, `sens` (pointer sensitivity), `aspect`, and from the host `fx`,`fy`,`fw`,`fh`: the UI's area inside the texture, in texture pixels |
| `typing` | `on` (bool) — capture the keyboard for a focused text field |
| `big` | `on` (bool) — open/close the big-screen view from the UI |
| `menu` | `open` (bool) — the UI decided the menu is closed: the driver is driving again (throttle, brake, steering moved), or the SDK's own pause is trusted instead (single player, where Esc really pauses) |
| `advisor` | `on` (bool) — the route advisor's TruckPlay panel shows the cab screen, or stays clear |
| `mapfeed` | `on` (bool), `premul` (optional bool: the game's map colour is premultiplied, undone for the feed) — the game's map feed, below |
| `layout` | `main` `{x,y,w,h}`, `panel` `{x,y,w,h}` or null — frame pixels: the cab screen's part of the UI's frame, and the F3 panel's own part in split screen (else the panel shows the cab screen's part). The markers get `main` (copied straight at the screen's size, else scaled), the big view shows `main`, the route advisor's panel `panel`. With a `panel`, the pointer goes on past the screen's right edge into it, as if the two were one wide screen |
| `targets` | `d` (pointer disc, px), `pad` (plate padding), `lean` (magnetism), `list` — flat `[x,y,w,h,radius,kind, …]` in texture pixels; kind 1 = button (the disc morphs into a plate), 2 = app icon (the icon lifts, the disc hands off), 3 = text field (I-beam). Sent while the pointer is out, when the layout moves (≤30/s) and once a second. |

The pointer itself is drawn by the plugin into the marker texture on every `Present`, at that
frame's mouse position: the UI's own frames lag by a few frames, the pointer does not.

## 2. Shared memory `Local\TruckPlayFrames`

Double-buffered BGRA frames written by the host, read by the plugin in `Present`.

```
offset 0, 128-byte header (little endian):
  u32 magic   = 0x31465054 ('TPF1')
  u32 version = 1
  u32 front   index (0/1) of the newest complete frame
  u32 flags   bit0 = host alive
  u64 seq     incremented after each complete frame
  u64 hostPid
  struct { u32 width, height, stride, dirtyX, dirtyY, dirtyW, dirtyH, pad } buf[2]
  u8  reserved[32]
offset 128:                    buffer 0 (MAX_W * MAX_H * 4 bytes)
offset 128 + MAX_W*MAX_H*4:    buffer 1
MAX_W = 2600, MAX_H = 2600   (twice the largest cab screen: the UI may be drawn at 2x, see display:scale)
```

Writer: bring `buffer[back]` up to date (whole frame), set its dims and the dirty rect relative to the
previous published frame, then `front = back`, then `seq++`.
Reader: read `seq`; if new, upload `buffer[front]`. When `seq == last + 1` only the dirty rect needs uploading,
otherwise the whole frame. Skip the frame if `seq` advanced by 2+ while copying.

The frame size always equals the marker texture size of the active screen (`shared/screens.json`).

### The game's map feed `Local\TruckPlayMap` (plugin → host)

The game's GPS scripts draw its navigation map as an image of a texture the game renders the map
into (`/material/ui/dashboard/bare_map.mat`). TruckPlay's GPS scripts draw that image right
beneath the marker, into the cab screen's render target; so when the marker is bound, the texture
bound just before it into the same target is the game's map, and the plugin copies it then.
While the host asks (`mapfeed` `on`), the plugin writes the whole map texture here (halved while
larger than 1024 px) up to 30 times a second, its colour straight and its alpha kept, through a
ring of staging textures read back two frames late so nothing waits. The UI crops and zooms it
around the truck (the middle of the map) and paints it in Apple Maps' colours
(`ui/src/maps/gameMapGl.ts`).

| offset | field |
|---|---|
| 0 | `magic` u32 `'TPM1'` (0x314D5054), `version` u32 = 1 |
| 8 | `front` u32 — the buffer last written whole; `flags` u32 (bit 0: the plugin is writing) |
| 16 | `seq` u64 — bumped after each frame |
| 24 | `w[2]` u32, then `h[2]` u32 at 32 — each buffer's size |
| 64 | two buffers of 1024 × 1024 × 4 bytes: RGBA, rows top down, tightly packed (`w` × 4 per row) |

The host reads the front buffer when `seq` changes (dropping a frame that two more writes may have
torn) and hands it to the UI as `mapfeed`.

The game keeps its map upside down (its GPS script draws it with `top=0.75 bottom=0.25`); the feed
turns it upright, so the UI gets it the right way up: a 3D view, the truck in the middle facing up.
The plugin holds on to the texture the game draws its map into: when the game stops drawing its GPS
screen (an outside camera), the map keeps coming from there (live while the game keeps drawing it,
else its last picture), and `ready` stays true until the plugin goes. Whether the game still draws
the map itself anew the plugin tells by the render target view it draws through (found the first
time it is bound): bound in the last 1.5 s is `fresh`. With an outside camera ETS2 keeps showing
its GPS screen but stops drawing the map, so a new mark only shows once the cab is in view again.

For working out the game's map away from the game, the plugin also writes the captured texture
as it is to `plugins	ruckplayare-map.bin` once a session (some seconds after the map comes),
`bare-map-route.bin` once while the game routes, and `bare-map-asked.bin` whenever a file named
`dump-map` appears in that folder: a 128-byte text header `TPMAP <w> <h> <dxgi format> <bytes per
pixel> <linear>` and the rows. The test cab shows such a file with `--baremap <file>`.

### The route advisor's panel

`mod/build-mod.mjs` lays a widget over the route advisor's own panel (`ui/adviser_gps.sii`: the
group with `id: 1000`, the map and its status lines, 280 × 244 of the 1440 × 900 layout), above
all of it: an image of `/material/ui/truckplay/advisor.mat`, a 642 × 559 BGRA texture (transparent
in the mod). The plugin recognises it by that size when the game creates it, makes it a render
target too, and draws the composed cab screen into it whenever that changes: at the screen's own
proportions, centred on a dark fill, corners rounded like the advisor's panels (straight alpha).
With `advisor` `on: false` it is cleared, and the advisor shows as it is.

Under `TRUCKPLAY_SHM` (the test cab) the names are `<value>` and `<value>Map`.

## 3. Host ↔ UI (Electron IPC, `window.tirplay`)

Besides relaying the pipe messages above:

| channel | direction | meaning |
|---|---|---|
| `screen` | host → UI | the plugin's `screen` plus `screen` (the mod's id for it, `generic`, or null) and `frame` (`{x,y,w,h}` in texture pixels, or null for the whole texture). The UI lays itself out in `frame`. |
| `screen:fit` | UI → host (invoke) | the driver's own fit for this truck (`{x,y,w,h}` as fractions of the texture, or null); the host answers with a new `screen` and a new `cfg` to the plugin |
| `ptr:route` | UI → host (invoke) | `true` while a `<webview>` page is on screen. The offscreen window does not pass the mouse on to such pages, so meanwhile the host does not inject pointer events itself: it sends each `ptr` to the UI with `px`,`py` (texture pixels) |
| `tp:route` | UI → host | the UI's verdict on a routed `ptr`: the same fields plus `target` (`'ui'` or the page's web contents id) and `ox`,`oy` (the page's offset). A press stays with its target until released. |
| `tp:guest-edit` | page preload → host | a text field in a page took (or left) the focus: typed keys go to that page |
| `tp:adblock` | page preload → host (sync) | whether the ad blocker is on; when it is, the preload also strips YouTube's ad data in the page |
| `adblock:set` | UI → host (invoke) | `on` (bool) — turn the ad blocker (Ghostery engine, uBlock Origin + EasyList lists, cached a week in userData) on or off for the pages' session; answers whether it is active |
| `save` | host → UI | read from the newest game save every 8 s: `garages` (owned garages, city tokens), `hq`, `waypoints` and `onlineWaypoints` (`[[x, z], …]` game coordinates of the route marked on the game's own map, single player's and the multiplayer/convoy one's: `economy.stored_gps_ahead_waypoints` / `stored_online_gps_ahead_waypoints`) |
| `media` | host → UI | what `truckplay-media.exe` says (section 4) |
| `media:cmd`, `media:state` | UI → host (invoke) | a command for a PC media session; the latest `sessions` |
| `volume:set` | UI → host (invoke) | `level` (0–1), `apps` — TruckPlay's own mixer volume (its pages, radio, YouTube Music), passed to the helper |
| `volume:report` | UI → host (invoke) | ask the helper for the mixer's sessions (diagnostics; logged) |
| `spotify:open` | UI → host (invoke) | start Spotify through the media helper's `launch` (minimized, plays on); answers `{ok, how}` |
| `split:set` | UI → host (invoke) | `{on, w, h}` — split screen: the page is widened by `w` CSS pixels for the F3 panel's part (`w` × `h`, right of the screen's); the host resizes the window and sends the plugin `layout` |
| `display:scale` | UI → host (invoke) | `'auto'`, `1`, `1.5` or `2` (Settings › Resolution): the host draws the UI at the cab screen's size times that, the page zoomed by as much (its CSS layout stays the texture's size; pointer events are injected in window pixels, × scale), keeps it in `display.json` and answers with `display` |
| `display` | host → UI | `{setting, scale, w, h, game}`: what the UI is drawn at now (pixels), and the game's picture `auto` follows (1× up to 1200 lines, 1.5× up to 2000, 2× above) |
| `mapfeed:want` | UI → host (invoke) | `{on}` — whether any map view on screen shows the game's map (ui/src/maps/gameMapFeed.ts); passed on to the plugin, and while `on` the host reads the feed 30 times a second |
| `mapfeed` | host → UI | a frame of the game's map: `seq`, `w`, `h`, `data` (RGBA bytes) |
| `mapfeed:status` | host → UI | the plugin's `mapfeed` status (`ready`, `fresh`); `ready: false` when the plugin disconnects |
| `lyrics:get` | UI → host (invoke) | `{title, artist, album, duration}` — `{synced: [{t, text, words?}], plain, instrumental}` or null, from LRCLIB (host/src/lyrics.js), kept on disk per song |
| `update` | host → UI | TruckPlay's own update (host/src/updater.js): `{state, current, latest, progress, checkedAt, error, auto, when}`; `state` is `off` (a developer build), `idle`, `checking`, `current`, `downloading`, `ready` or `error` (`error`: `network`, `verify`, `install`, `stuck`); `when` says when a ready one goes in (`game`: once the game closes, `window`: once the trial window does) |
| `update:state`, `update:auto`, `update:check` | UI → host (invoke) | the latest `update`; turn automatic updates on or off (`on`, bool; kept in the updater's state.json); look now (the driver pressed Check: fetched and installed even with automatic updates off). Each answers with `update` |

TruckPlay's own update events come as `ev` too: `truckplay.update.ready` (`version`, `when`: a newer
release's installer came down and matched GitHub's SHA-256) and `truckplay.updated` (`version`: the
first start of a version an update put in, sent once the cab screen shows).

Pages (`<webview>`) talk to the UI with `sendToHost`: `tp-edit` (a text field is focused),
`tp-theme` (the page's theme colour), `tp-scroll` (direction, for tucking the bars),
`tp-fullscreen` (the page asked for fullscreen: it is shown filling the page's own view, since real
fullscreen would freeze the offscreen frames) and `tp-media` (what the page plays: `title`,
`artist`, `album`, `art`, `playing`, `pos`, `dur`). A right click does nothing (no context menu, no
going back).

## 4. Media helper `truckplay-media.exe`

Started by the host; JSON lines on stdin (in) and stdout (out). It exits when stdin closes.

| direction | t | fields |
|---|---|---|
| out | `sessions` | `current`, `list` of `{id, app, title, artist, album, status, pos, dur, ts, shuffle, repeat, caps}` (Windows media sessions: Spotify, browsers, …) |
| out | `art` | `id`, `key`, `data` (data URL) when a session's artwork changes |
| out | `app` | `app`, `name`, `icon` — once per app |
| out | `volumes` | `list` — the mixer's audio sessions (answer to `volumes`) |
| out | `launched` | `app`, `ok`, `how` (`running`/`desktop`/`store`/`none`) — answer to `launch` |
| in | `cmd` | `id`, `cmd` (`play`/`pause`/`toggle`/`next`/`prev`/`seek`/`shuffle`/`repeat`), `v` |
| in | `refresh` | send `sessions` again |
| in | `volume` | `level`, `pids`, `apps` — the mixer volume of those processes' audio sessions (and their children's), kept as new sessions appear |
| in | `volumes` | report the mixer's sessions |
| in | `launch` | `app` (`spotify`) — start it minimized (the desktop app with `--minimized`, else the Microsoft Store app through Windows' activation manager, its window then minimized without activation) and, once its media session appears, play |
