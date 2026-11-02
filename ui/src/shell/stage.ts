import { createContext, useContext } from 'react';
import { createStore } from '../state/store';

/** Size of the area right of the rail, in CSS pixels, plus the pt scale (1pt = px). */
export interface StageSize {
  width: number;
  height: number;
  pt: number;
}

export const StageContext = createContext<StageSize>({ width: 800, height: 480, pt: 1 });
export const useStage = () => useContext(StageContext);

/** Stage origin in screen coordinates, kept fresh so icons can report rects relative to it. */
export const stageOrigin = createStore({ left: 0, top: 0 });

/** Set by the pager while a swipe is in progress so taps that end a drag are ignored. */
export const gesture = { dragging: false, lastDragEnd: 0 };
export const tapAllowed = () => !gesture.dragging && performance.now() - gesture.lastDragEnd > 120;
