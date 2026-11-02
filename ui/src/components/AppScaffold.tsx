import { motion } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '../icons/glyphs';
import { goBack } from '../shell/appLayer';
import { spring } from '../design/motion';
import { useDragScroll } from './useDragScroll';
import './appScaffold.css';

interface Props {
  title: string;
  children: ReactNode;
  trailing?: ReactNode;
  /** Override the back action (defaults to the app's back stack, closing the app at its root). */
  onBack?: () => void;
  scroll?: boolean;
  className?: string;
}

export function AppScaffold({ title, children, trailing, onBack, scroll = true, className }: Props) {
  const body = useRef<HTMLDivElement>(null);
  useDragScroll(body);
  return (
    <div className={`app ${className ?? ''}`}>
      <header className="app__bar">
        <motion.button
          className="app__back glass"
          data-pointer="highlight"
          onClick={onBack ?? goBack}
          whileTap={{ scale: 0.88 }}
          transition={spring.snappy}
          aria-label="geri"
        >
          <ChevronLeft />
        </motion.button>
        <h1 className="app__title">{title}</h1>
        <div className="app__trailing">{trailing}</div>
      </header>
      <div className={`app__body ${scroll ? 'app__body--scroll' : ''}`} ref={body}>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  return (
    <section className="section">
      {title && <h2 className="section__title">{title}</h2>}
      <div className="section__card">{children}</div>
      {footer && <p className="section__footer">{footer}</p>}
    </section>
  );
}

interface RowProps {
  icon?: ReactNode;
  tint?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  /** Entrance delay in seconds: the row slides in when it first shows. */
  appear?: number;
}

export function Row({ icon, tint, title, subtitle, value, chevron, onClick, children, appear }: RowProps) {
  // Rows of a list that has just arrived slide in one after another (`appear`: this row's delay).
  const enter =
    appear === undefined
      ? {}
      : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { ...spring.smooth, delay: appear } } };
  const inner = (
    <>
      {icon && (
        <span className="row__icon" style={{ background: tint ?? 'var(--gray)' }}>
          {icon}
        </span>
      )}
      <span className="row__text">
        <span className="row__title">{title}</span>
        {subtitle && <span className="row__subtitle">{subtitle}</span>}
      </span>
      {value !== undefined && <span className="row__value tabular">{value}</span>}
      {children}
      {chevron && (
        <span className="row__chevron">
          <ChevronRight />
        </span>
      )}
    </>
  );
  return onClick ? (
    <motion.button className="row row--button" data-pointer="highlight" onClick={onClick} whileTap={{ scale: 0.985 }} transition={spring.snappy} {...enter}>
      {inner}
    </motion.button>
  ) : (
    <motion.div className="row" {...enter}>
      {inner}
    </motion.div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${on ? 'toggle--on' : ''}`} data-pointer="highlight" onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <motion.span className="toggle__knob" layout transition={spring.snappy} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(o => (
        <button key={o.value} className="segmented__item" data-pointer="highlight" onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg-${options.map(x => x.value).join('-')}`} className="segmented__thumb" transition={spring.snappy} />}
          <span className="segmented__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Empty({ glyph, title, hint }: { glyph: ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty">
      <span className="empty__glyph">{glyph}</span>
      <span className="empty__title">{title}</span>
      {hint && <span className="empty__hint">{hint}</span>}
    </div>
  );
}
