# The README's pictures: the UI at 2x, as the game shows it, saved by the host into
# %APPDATA%\tirplay-host-cab\captures\<name>.png (the "capture" message; test cab only). A made-up
# song with a cover of its own (the demo's "Gece Yolu") stands in for the PC's music: Now Playing
# is held on it whatever the PC plays, so no real song or album art is captured. The video in the
# F3 panel is Big Buck Bunny (Blender Foundation, CC BY 3.0).
# Run with --marker 1282x794 --advisor --baremap <a map dumped from the game>; then
# python tools/readme/build.py turns the captures into docs/img.
wait 7000
js __tp.settings.patch({ screenScale: 2, appearance: 'dark', mapBuildings: true, advisorScreen: true })
js window.__art = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#16195a'/><stop offset='.5' stop-color='#b83b7d'/><stop offset='.62' stop-color='#ff8f4f'/></linearGradient><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#3a1640'/><stop offset='1' stop-color='#0a0614'/></linearGradient></defs><rect width='600' height='600' fill='url(#s)'/><circle cx='300' cy='352' r='118' fill='#ffd37c'/><rect y='372' width='600' height='228' fill='url(#g)'/><path d='M286 372 L314 372 L540 600 L60 600 Z' fill='#1b1028'/><path d='M298 392 L302 392 L305 430 L295 430 Z M296 460 L304 460 L310 525 L290 525 Z' fill='#ffd37c'/></svg>"); window.__np = { source: 'pc', title: 'Gece Yolu', artist: 'Mavi Şerit', album: 'Otoban Şarkıları', artwork: window.__art, hue: 330, playing: true, position: 74, duration: 236, updatedAt: performance.now(), canSkip: true, app: { name: 'Spotify', icon: '' }, canSeek: true, shuffle: false, repeat: 'none' }; window.__keep = () => { if (__tp.nowPlaying.get().title !== 'Gece Yolu') __tp.nowPlaying.set({ ...window.__np }); }; __tp.nowPlaying.subscribe(window.__keep); window.__keep(); window.__fakeTimer = setInterval(window.__keep, 200)
wait 5000
# The demo drive stands still from here: no figure rolls over in the middle of a picture.
js __tp.stopDemo()
js __tp.goToPage(1)
wait 3000
send {"t":"capture","name":"home-dark"}
wait 900
js __tp.goToPage(2)
wait 2500
send {"t":"capture","name":"apps-dark"}
wait 900
js __tp.openApp('maps', null)
wait 4000
send {"t":"capture","name":"maps-dark"}
wait 900
js __tp.closeApp()
wait 1500
js __tp.openApp('nowplaying', null)
wait 3500
send {"t":"capture","name":"nowplaying-dark"}
wait 900
js __tp.closeApp()
wait 1500
js __tp.openApp('truck', null)
wait 3000
send {"t":"capture","name":"truck-dark"}
wait 900
js __tp.closeApp()
wait 1500
js __tp.openApp('job', null)
wait 3000
send {"t":"capture","name":"job-dark"}
wait 900
js __tp.closeApp()
wait 1500
js __tp.settings.patch({ appearance: 'light' })
js __tp.goToPage(1)
wait 3000
send {"t":"capture","name":"home-light"}
wait 900
js __tp.openApp('maps', null)
wait 4000
send {"t":"capture","name":"maps-light"}
wait 900
js __tp.closeApp()
wait 1500
js __tp.goToPage(2)
wait 2500
send {"t":"capture","name":"apps-light"}
wait 900
js __tp.settings.patch({ appearance: 'dark' })
js __tp.goToPage(1)
wait 1500
js __tp.openApp('youtube', null)
wait 7000
js document.querySelector('webview')?.loadURL('https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=300')
wait 12000
js __tp.closeApp()
wait 1500
js __tp.openApp('maps', null)
wait 2500
js __tp.toggleSplit()
wait 6000
send {"t":"capture","name":"split-dark"}
advisor readme-panel
wait 1500
js __tp.toggleSplit()
wait 2000
js clearInterval(window.__fakeTimer)
quit
