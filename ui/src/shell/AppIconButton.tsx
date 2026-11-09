import { motion } from 'motion/react';
import { useRef } from 'react';
import { AppIcon } from '../icons/appIcons';
import { appLabel } from '../apps/registry';
import { useT } from '../state/i18n';
import { useStore } from '../state/store';
import { openApp, resolvedAppearance, split, type AppId } from '../state/ui';
import { toggleSplit } from '../state/split';
import { spring } from '../design/motion';
import { tapAllowed } from './stage';
import { hiddenIcon, type IconPlace } from './appLayer';
import './appIconButton.css';

interface Props {
  app: AppId;
  size: number; // px
  label?: boolean;
  place: IconPlace;
}

export function AppIconButton({ app, size, label = true, place }: Props) {
  const t = useT();
  const dark = useStore(resolvedAppearance, a => a === 'dark');
  // The copy the app zooms out of (and back into) hides while the zoom runs, so the zoom reads as
  // the icon itself.
  const hidden = useStore(hiddenIcon, h => h?.app === app && h.place === place);
  const ref = useRef<HTMLButtonElement>(null);

  const splitOn = useStore(split, s => s.on);
  const open = () => {
    if (!tapAllowed()) return;
    // The Split icon is a switch, not an app.
    if (app === 'split') {
      toggleSplit();
      return;
    }
    const r = ref.current?.querySelector('.app-icon__art')?.getBoundingClientRect();
    openApp(app, r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null, place);
  };

  return (
    <motion.button
      ref={ref}
      className={`app-icon${app === 'split' && splitOn ? ' app-icon--on' : ''}`}
      data-app-icon={app}
      data-place={place}
      data-pointer="lift"
      onClick={open}
      whileTap={{ scale: 0.9 }}
      transition={spring.snappy}
      style={{ width: label ? size * 1.6 : size }}
      aria-label={t(appLabel(app))}
    >
      {/* Gone at once when the zoom takes over; back with a short fade once the app is open. */}
      <span
        className="app-icon__art"
        style={{ width: size, height: size, opacity: hidden ? 0 : 1, transition: hidden ? 'none' : 'opacity 0.28s cubic-bezier(0.2, 0.9, 0.25, 1)' }}
      >
        <AppIcon app={app} dark={dark} />
      </span>
      {label && <span className="app-icon__label">{t(appLabel(app))}</span>}
    </motion.button>
  );
}
