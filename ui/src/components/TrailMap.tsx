// Heading-up view of the road just driven, used until the game map is built (map/ pipeline).
// Positions are game-world meters: x east, z south; heading 0..1 counter-clockwise from north.

import { useEffect, useRef } from 'react';
import { telemetry } from '../state/telemetry';
import { resolvedAppearance } from '../state/ui';
import { trail } from '../state/trail';

export function TrailMap({ metersVisible = 420, puckAt = 0.68 }: { metersVisible?: number; puckAt?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    let raf = 0;
    let dirty = true;

    const draw = () => {
      raf = 0;
      if (!dirty) return;
      dirty = false;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      const dark = resolvedAppearance.get() === 'dark';
      const t = telemetry.get();
      const p = t.truck.pos;
      const a = p.h * Math.PI * 2;
      const scale = h / metersVisible;
      const px = w / 2;
      const py = h * puckAt;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const project = (x: number, z: number): [number, number] => {
        const dx = (x - p.x) * scale;
        const dz = (z - p.z) * scale;
        return [px + dx * cos - dz * sin, py + dx * sin + dz * cos];
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = dark ? '#1c222b' : '#f1efe9';
      ctx.fillRect(0, 0, w, h);

      // Faint block grid that turns with the truck, so motion reads even on an empty map.
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
      ctx.lineWidth = 1;
      const cell = 120;
      const gx = Math.floor(p.x / cell) * cell;
      const gz = Math.floor(p.z / cell) * cell;
      const reach = metersVisible * 1.6;
      ctx.beginPath();
      for (let x = gx - reach; x <= gx + reach; x += cell) {
        const [x1, y1] = project(x, gz - reach);
        const [x2, y2] = project(x, gz + reach);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      for (let z = gz - reach; z <= gz + reach; z += cell) {
        const [x1, y1] = project(gx - reach, z);
        const [x2, y2] = project(gx + reach, z);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();

      if (trail.length > 1) {
        const path = () => {
          ctx.beginPath();
          trail.forEach((q, i) => {
            const [x, y] = project(q.x, q.z);
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          });
          ctx.lineTo(px, py);
        };
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        path();
        ctx.strokeStyle = dark ? '#0d1117' : '#d4d0c6';
        ctx.lineWidth = 16;
        ctx.stroke();
        path();
        ctx.strokeStyle = dark ? '#4a5260' : '#ffffff';
        ctx.lineWidth = 11;
        ctx.stroke();
      }

      // Puck: white disc, blue arrow, soft halo.
      ctx.save();
      ctx.translate(px, py);
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,132,255,0.16)';
      ctx.fill();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(7, 8);
      ctx.lineTo(0, 4.5);
      ctx.lineTo(-7, 8);
      ctx.closePath();
      ctx.fillStyle = '#0a84ff';
      ctx.fill();
      ctx.restore();
    };

    const schedule = () => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const offT = telemetry.subscribe(schedule);
    const offA = resolvedAppearance.subscribe(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      offT();
      offA();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [metersVisible, puckAt]);

  return <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
