// Apple describes springs by perceived duration and bounce (SwiftUI's .smooth / .snappy / .bouncy).
// Motion takes the same two numbers, so the feel carries over 1:1.

import type { Transition } from 'motion/react';

export const spring = {
  /** Default for layout and navigation: settles without overshoot. */
  smooth: { type: 'spring', visualDuration: 0.5, bounce: 0 },
  /** Quick, decisive UI responses: buttons, toggles, small moves. */
  snappy: { type: 'spring', visualDuration: 0.32, bounce: 0.12 },
  /** Things that arrive: banners, sheets, the app zoom. A hint of overshoot. */
  bouncy: { type: 'spring', visualDuration: 0.5, bounce: 0.22 },
  /** App launch / close zoom, tuned to iOS's open timing. */
  zoom: { type: 'spring', visualDuration: 0.46, bounce: 0.1 },
  /** Paging between home screens. */
  page: { type: 'spring', visualDuration: 0.42, bounce: 0.06 },
  /** The pointer: fast and slightly loose, like iPadOS. */
  pointer: { type: 'spring', visualDuration: 0.16, bounce: 0.18 },
} satisfies Record<string, Transition>;

export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.42, 0, 0.18, 1] as const,
};
