// From the game's newest save (read by the host): the garages the player owns, the headquarters,
// and the waypoints left on the game's own GPS routes (game metres; the last is where it ends) —
// single player's and multiplayer's (Convoy), which the game keeps apart. The game saves every few
// minutes while driving, so this trails the game by that much.

import { createStore } from './store';

export interface GameSave {
  garages: string[];
  hq: string;
  waypoints: Array<[number, number]>;
  onlineWaypoints: Array<[number, number]>;
  /** When the save was written (ms since epoch); 0 before any. */
  at: number;
}

export const gameSave = createStore<GameSave>({ garages: [], hq: '', waypoints: [], onlineWaypoints: [], at: 0 });
