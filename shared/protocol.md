# TruckPlay plugin ↔ host protocol

Two channels connect `truckplay.dll` (inside `eurotrucks2.exe`) and the TruckPlay host (Electron).

## 1. Named pipe `\\.\pipe\tirplay`

The plugin is the server; the host connects (and reconnects every second when the game is not running).
Messages are UTF-8 JSON objects, one per line (`\n`). Every message has a `t` (type) field.

### plugin → host

| t | when | fields |
|---|---|---|
| `hello` | on connect | `plugin` (version), `game` (`eut2`), `sdk` (telemetry game version, e.g. `1.21`), `pointer` (true: the plugin draws the pointer itself) |
| `tel` | 20 Hz | `paused`, `game{time,rest,brk,scale,mp}`, `truck{…}`, `trailer{…}`, `job{…}` — see `telemetry.cpp` |
| `ev` | gameplay event | `id` (e.g. `player.fined`), `a` (attributes object) |
| `screen` | a marker texture was created (player got into a truck) | `w`, `h`, `fmt`. Any BGRA texture 1282 px wide is a marker: the mod gives each measured cab screen its own height (`shared/screens.json`); 1282×1282 is the generic script's |
| `ptr` | pointer while interacting | `act` (`enter`/`leave`/`move`/`down`/`up`/`wheel`), `x`,`y` (0–1, top-left origin), `b`, `dy` |
| `key` | keyboard while typing | `act` (`down`/`up`/`char`), `vk` or `ch` |
| `mode` | big-screen toggle | `big` (bool) |
| `stats` | every 5 s | input diagnostics (`wmInput`, `diMouse`, `fps`, `uploads`, …) |
| `eval` | test cab only | `js` — the host (started with `--profile`) runs it in the UI |
| `menu` | Esc pressed while not typing and not in the big view | `open` (bool) — the plugin's guess at the game's Esc menu. It toggles on every Esc, so it can drift; the UI corrects it (see `menu` below) |
| `view` | on connect, and when the game's picture changes size | `w`, `h` — the swap chain's size (0 before the first frame); the host sizes the HUD to it |

### host → plugin

| t | fields |
|---|---|
| `hello` | `host` (version) |
| `cfg` | `holdVk`, `zoomVk`, `sens` (pointer sensitivity), `aspect`, and from the host `fx`,`fy`,`fw`,`fh`: the UI's area inside the texture, in texture pixels |
| `typing` | `on` (bool) — capture the keyboard for a focused text field |
| `big` | `on` (bool) — open/close the big-screen view from the UI |
| `menu` | `open` (bool) — the UI decided the menu is closed: the driver is driving again (throttle, brake, steering moved), or the SDK's own pause is trusted instead (single player, where Esc really pauses) |
| `hud` | `pos` (`top`/`bottom`) — where the HUD goes on the game's picture |
| `wind` | `on` (bool), `drop` (degrees) — the windshield HUD: shown in the cab view or not, and how far below the line of sight its image sits |
| `advisor` | `on` (bool) — the route advisor's TruckPlay panel shows the cab screen, or stays clear |
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
MAX_W = 2048, MAX_H = 1600
```

Writer: bring `buffer[back]` up to date (whole frame), set its dims and the dirty rect relative to the
previous published frame, then `front = back`, then `seq++`.
Reader: read `seq`; if new, upload `buffer[front]`. When `seq == last + 1` only the dirty rect needs uploading,
otherwise the whole frame. Skip the frame if `seq` advanced by 2+ while copying.

The frame size always equals the marker texture size of the active screen (`shared/screens.json`).

### The HUD's channel `Local\TruckPlayHud`

The same layout with MAX_W = 2048, MAX_H = 800, written by the host's second offscreen window
(`host/src/hud.js`, the page `ui/hud.html`). Its frames are transparent, premultiplied BGRA, at
exactly the size they appear on the game's picture. The plugin draws them 1:1 over the picture
in `Present`, centred, near the top (or above the bottom edge, after `hud` `pos: bottom`).
`flags` bit 1 = draw it. The host clears the bit once the card's exit animation has finished.
The plugin draws nothing:
- while the game is paused or the plugin thinks its Esc menu is open;
- while the big view is up;
- while no host is connected.

### The windshield HUD's channel `Local\TruckPlayWind`

The same layout with MAX_W = 1600, MAX_H = 800, from the host's third offscreen window (the same
page as `ui/hud.html?view=wind`). The plugin draws it where a fixed point of the cab shows on the
picture: 2.4 m ahead of the driver's default eye point (SDK `head.position`) and `drop` degrees below
the line of sight, seen from the head's current offset (`truck.head.offset`, position and
orientation), with a 50° vertical field of view; scaled with that distance, faded out when the
driver looks more than ~20° away. Only in the cab view: the plugin watches the game's
`PSSetShaderResources` for the cab screen's render target (found the first time the GPS draws the
marker into it) being sampled, which happens only while the interior is drawn. While it shows,
the card above fades out (it comes back in the outside cameras). Same no-draw conditions as the
card.

### The route advisor's panel

`mod/build-mod.mjs` adds a widget on top of the route advisor's stack (`ui/adviser_gps.sii`): an
image of `/material/ui/truckplay/advisor.mat`, a 642 × 361 BGRA texture (transparent in the mod).
The plugin recognises it by that size when the game creates it, makes it a render target too, and
draws the composed cab screen into it whenever that changes: at the screen's own proportions inside
the panel's 270 : 152, corners rounded, the rest transparent (straight alpha). With `advisor`
`on: false` it is cleared.

Under `TRUCKPLAY_SHM` (the test cab) the names are `<value>`, `<value>Hud` and `<value>Wind`.

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
| `hud:frame` | UI → host (invoke) | what the HUD shows now (`ui/src/hud/types.ts` `HudFrame`), at most ten times a second and only when it changes; the host passes it to the HUD window as `hud` and raises the draw bit when `show` |
| `wind:frame` | UI → host (invoke) | the same for the windshield HUD (`WindFrame`); the draw bit goes up when `on` |
| `hud:layout` | UI → host (invoke) | `{pos, size, wind, windHeight, advisor}` from Settings: the host resizes the HUD windows (`size` s/m/l: the card's height as 8.5/10.5/13 % of the picture's, the windshield HUD's as 7.5/9/11 %) and tells the plugin `hud`, `wind` (`windHeight` low/mid/high = 9/6.5/4°) and `advisor` |
| `hud:idle`, `wind:idle` | HUD windows → host (invoke) | the card (or the windshield HUD) has finished leaving: clear the draw bit |
| `voice:packs` | UI → host (invoke) | the installed voice packs: `{ "<lang>-<gender>": {voice, provider} }` (from `voices/*/pack.json`) |
| `voice:clip` | UI → host (invoke) | `pack`, `key` — one phrase of a pack (`voices/<pack>/<key>.mp3`, see `shared/voice.json`), or null |

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
