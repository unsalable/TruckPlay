import { createStore } from './store';
import { telemetry, type GameEvent } from './telemetry';

// The road log: every gameplay event with the game time it happened, for Teslimat and Mesajlar.

export interface LoggedEvent {
  id: number;
  kind: string;
  title: string;
  body: string;
  gameTime: number;
  at: number;
}

let n = 0;
export const eventLog = createStore<LoggedEvent[]>([]);

export function recordEvent(e: GameEvent, title: string, body: string) {
  const entry: LoggedEvent = { id: ++n, kind: e.id, title, body, gameTime: telemetry.get().game.time, at: Date.now() };
  eventLog.set(list => [entry, ...list].slice(0, 50));
}
