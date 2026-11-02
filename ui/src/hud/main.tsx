// The HUDs' own page (hud.html), drawn by the host in offscreen windows of their own and laid over
// the game by the plugin.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/opsz.css';
import '../design/tokens.css';
import { HudApp } from './HudApp';
import { WindApp } from './WindApp';

// The same page draws the card over the road and, as hud.html?view=wind, the windshield HUD.
const wind = new URLSearchParams(location.search).get('view') === 'wind';
document.documentElement.dataset.view = wind ? 'wind' : 'card';

createRoot(document.getElementById('root')!).render(<StrictMode>{wind ? <WindApp /> : <HudApp />}</StrictMode>);
