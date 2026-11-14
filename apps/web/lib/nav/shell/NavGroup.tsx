'use client';

import { ChevronDown, Pin } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import type { GroupKey } from '../types';
import { GROUP_ICONS } from '../icons';
import { DOT_CLASS, NavIcon } from './NavItem';
import css from './shell.module.css';

export type FlyKey = GroupKey | 'favourites';

export interface NavGroupProps {
  group: FlyKey;
  label: string;
  /** Panel: the group's list is open. */
  open: boolean;
  /** Rail: its flyout is showing. */
  flyOpen: boolean;
  /** Rail vs panel decides what aria-expanded reflects (§9). */
  rail: boolean;
  /** The group holds the current page. */
  here: boolean;
  /** T2 money inside (a dot only, never an amount; counts never bubble — §5.1). */
  dot: 'danger' | 'warn' | null;
  /** Favourites: always open in the panel, no pin, no fold. */
  fav?: boolean;
  /** Screen-reader words. */
  words: { here: string; danger: string; warn: string; pin: string; pinTitle: string; pinMeaning: string; groupTip: string };
  flyTop?: number | null;
  onHeader: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onPin?: () => void;
  headerRef?: (el: HTMLButtonElement | null) => void;
  flyRef?: (el: HTMLDivElement | null) => void;
  onPointerEnterTile?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerLeaveTile?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerEnterFly?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeaveFly?: (e: React.PointerEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}

/**
 * A group (sidebar spec §1.1–§1.3, §9): `div[role=group]` labelled by its name,
 * a header button (panel: glyph 16 · name · chevron · T2 dot; rail: a tile with
 * a 12 px name), and its list. In the rail the same list is the flyout beside
 * the menu, with a 16/24 title and the pin — so Tab order stays DOM order.
 */
export function NavGroup({
  group,
  label,
  open,
  flyOpen,
  rail,
  here,
  dot,
  fav = false,
  words,
  flyTop,
  onHeader,
  onPin,
  headerRef,
  flyRef,
  onPointerEnterTile,
  onPointerLeaveTile,
  onPointerEnterFly,
  onPointerLeaveFly,
  children,
}: NavGroupProps) {
  const labId = `rm-nav-gl-${group}`;
  const headerId = `rm-nav-gh-${group}`;
  const listId = `rm-nav-group-${group}`;
  const panelOpen = fav ? true : open;
  const expanded = rail ? flyOpen : panelOpen;
  // aria-current on the header only when it stands for the page: a folded group (panel) or any tile (rail).
  const current = here && (rail || !panelOpen);
  const showDot = dot && (rail || !panelOpen);
  const Glyph = GROUP_ICONS[group];
  return (
    <div
      role="group"
      aria-labelledby={labId}
      className={cn(css.grp, fav && css.fav)}
      data-group={group}
      data-open={panelOpen ? 'true' : 'false'}
      data-fly={flyOpen ? 'open' : undefined}
      data-here={here ? 'true' : undefined}
      style={flyTop != null ? ({ ['--rm-fly-top' as string]: `${flyTop}px` } as React.CSSProperties) : undefined}
    >
      <button
        ref={headerRef}
        id={headerId}
        type="button"
        data-nav-group={group}
        aria-expanded={fav && !rail ? undefined : expanded}
        aria-controls={listId}
        aria-current={current ? 'true' : undefined}
        tabIndex={fav && !rail ? -1 : undefined}
        onClick={onHeader}
        onPointerEnter={onPointerEnterTile}
        onPointerLeave={onPointerLeaveTile}
        data-tip={label}
        data-tip-text={words.groupTip}
        data-tip-when="rail"
        data-tip-focus-only=""
        className={cn(css.gh, css.tile, fav && css.favHead, 'text-xs font-semibold leading-4')}
      >
        <span className={css.ic}>
          <NavIcon icon={Glyph} />
          {showDot ? <span aria-hidden="true" className={cn(css.railDot, DOT_CLASS[dot])} /> : null}
        </span>
        <span id={labId} className={css.lab}>
          {label}
        </span>
        <span aria-hidden="true" className={cn(css.short, 'font-medium')}>
          {label}
        </span>
        <span aria-hidden="true" className={css.ghLab}>
          <span className="truncate">{label}</span>
          {fav ? null : <ChevronDown aria-hidden="true" strokeWidth={2} className={css.chev} />}
        </span>
        <span className={css.gx}>{showDot ? <span aria-hidden="true" data-group-dot={dot} className={cn(css.gdot, DOT_CLASS[dot])} /> : null}</span>
        {showDot ? <span className="sr-only">, {dot === 'danger' ? words.danger : words.warn}</span> : null}
        {current ? <span className="sr-only">, {words.here}</span> : null}
      </button>
      <div ref={flyRef} className={css.fly} data-fly-panel={group} onPointerEnter={onPointerEnterFly} onPointerLeave={onPointerLeaveFly}>
        <div className={css.flyHead}>
          <span className={cn(css.flyTitle, 'truncate text-base font-bold leading-6 text-ink')}>{label}</span>
          {onPin ? (
            <button
              type="button"
              className={css.ib}
              onClick={onPin}
              aria-label={words.pin}
              data-tip={words.pinTitle}
              data-tip-text={words.pinMeaning}
            >
              <Pin aria-hidden="true" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <ul id={listId} className={css.list}>
          {children}
        </ul>
      </div>
    </div>
  );
}
