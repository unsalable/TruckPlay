import { useEffect, useState } from 'react';

/** Re-render every `ms` milliseconds (0 = never), for clocks and progress bars. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!ms) return;
    const id = window.setInterval(() => setNow(performance.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
