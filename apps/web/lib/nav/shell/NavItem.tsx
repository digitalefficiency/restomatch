'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Eye, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import { cappedCount, type BadgeWords } from '@/lib/components/notifications';
import { useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { nav } from '@/lib/i18n/messages/nav';
import { navShell } from '@/lib/i18n/messages/nav/shell';
import { formatIls } from '@/lib/money';
import type { BadgeLook, BadgeValueLike, DotTone } from '../badgeLook';
import { MIRRORED_ICONS, OPTICAL_SCALE, iconFor } from '../icons';
import css from './shell.module.css';

export const DOT_CLASS: Record<DotTone, string> = {
  danger: css.dotDanger!,
  warn: css.dotWarn!,
  neutral: css.dotNeutral!,
};

/**
 * A nav glyph at 20 px (stroke 1.75), with the spec's optical size (§3: the
 * glyph scales by k, its stroke divides by k) and RTL mirroring only for list
 * glyphs. The current row's colour and stroke 2 come from the stylesheet.
 * `duo`: DS3's two-tone state for the current page (DS3 SPEC §6, §10.4): a
 * filled copy of the glyph underneath, composited once at 18 %, the same
 * technique as DS3-01's <Icon state="active">.
 */
export function NavIcon({ icon: Icon, k = 1, mirrored = false, duo = false }: { icon: LucideIcon; k?: number; mirrored?: boolean; duo?: boolean }) {
  const className = mirrored ? 'rtl:-scale-x-100' : undefined;
  const style = k !== 1 ? { transform: `scale(${k})` } : undefined;
  const line = <Icon aria-hidden="true" width={20} height={20} strokeWidth={1.75 / k} className={className} style={style} />;
  if (!duo) return line;
  return (
    <span className={css.duo}>
      <Icon aria-hidden="true" width={20} height={20} fill="currentColor" stroke="none" className={cn(css.duoFill, className)} style={style} />
      {line}
    </span>
  );
}

export function iconProps(key: string): { icon: LucideIcon; k: number; mirrored: boolean } {
  return { icon: iconFor(key), k: OPTICAL_SCALE[key] ?? 1, mirrored: MIRRORED_ICONS.has(key) };
}

/**
 * "RestoMatch" inside a Hebrew (or any right-to-left) label is marked as English and kept left-to-right
 * (sidebar spec §9: `<span lang="en" dir="ltr">`), so a screen reader says it in English and the bidi
 * algorithm never reorders it ("שאלו את RestoMatch").
 */
export function withBrand(label: string): React.ReactNode {
  const parts = label.split(/(RestoMatch)/);
  if (parts.length === 1) return label;
  return parts.map((part, i) =>
    part === 'RestoMatch' ? (
      <span key={i} lang="en" dir="ltr">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * The badge's words for the link's accessible name and the rail tile's tooltip
 * line: "4 פריטים, ‏296 ₪ בסיכון, חוסם תשלום" (§9: meaning in visually hidden
 * text inside the link; the visible pill is aria-hidden). Built from the LOOK,
 * so they say exactly what the pill shows: no ₪ where the pill has none — for
 * chef and receiver (the client's second ₪ guard, §5.3) and for an amount that
 * is not T2 money — and nothing for a row whose pill is not shown.
 */
export function badgeWordsFor(
  value: BadgeValueLike | undefined,
  look: BadgeLook | null,
  locale: Locale,
  words: BadgeWords,
): string | null {
  if (!value || !look) return null;
  const parts: string[] = [];
  if (look.count > 0) parts.push(words.items(cappedCount(look.count, locale)));
  if (look.agorot !== null && look.agorot > 0) {
    const amount = formatIls(look.agorot / 100, { locale });
    parts.push(value.money === 'owed' ? words.owed(amount) : words.atRisk(amount));
  }
  if (value.block) parts.push(words.blocking);
  return parts.length ? parts.join(', ') : null;
}

/** The badge words for the side menu and the phone bar: "פריט אחד", "{n} פריטים", "יותר מ־99 פריטים". */
export function useNavBadgeWords(): BadgeWords {
  const t = useT(nav) as unknown as (key: string, vars?: Record<string, string>) => string;
  const ts = useT(navShell) as unknown as (key: string) => string;
  return useMemo(
    () => ({
      items: (count: string) => {
        const plain = count.replace(/[\u200e\u200f\u2066-\u2069]/g, '');
        if (plain.endsWith('+')) return ts('badge.over');
        if (plain === '1') return ts('badge.one');
        return t('badge.items', { count });
      },
      atRisk: (amount: string) => t('badge.atRisk', { amount }),
      owed: (amount: string) => t('badge.owed', { amount }),
      blocking: t('badge.blocking'),
    }),
    [t, ts],
  );
}

/**
 * One badge pill (§5.1): solid danger only when a payment is blocked (and only
 * the first one in the menu), warn-subtle for other money that waits, a quiet
 * count otherwise. ₪ goes through formatIls (inside <bdi>, no title); a count is
 * LTR-isolated and capped at 99+. A changed value fades in over 150 ms.
 */
export function Pill({ look, tone, locale }: { look: BadgeLook; tone: BadgeValueLike['tone']; locale: Locale }) {
  const money = look.agorot !== null && look.agorot > 0;
  const sig = `${look.pill}:${money ? look.agorot : look.count}:${look.innerDot ? 1 : 0}`;
  return (
    <span
      key={sig}
      aria-hidden="true"
      data-nav-badge={look.pill === 'solid' ? 'block' : look.pill === 'warn' ? 'warn' : tone}
      className={cn(
        css.pill,
        css.pillIn,
        look.pill === 'solid' && css.pillSolid,
        look.pill === 'warn' && css.pillWarn,
        'text-xs font-semibold leading-4',
      )}
    >
      {look.innerDot ? <span className={css.innerDot} /> : null}
      {/* The rounded ₪ straight from formatIls, without <Money>'s native "exact amount" title: in the open panel a
          tooltip belongs only to icon-only controls (§1.6), and the pill is aria-hidden (the link's words carry it). */}
      {money ? (
        <bdi className="num whitespace-nowrap">{formatIls(look.agorot! / 100, { locale, maximumFractionDigits: 0 })}</bdi>
      ) : (
        <bdi dir="ltr">{cappedCount(look.count, locale)}</bdi>
      )}
    </span>
  );
}

export interface NavItemProps {
  itemKey: string;
  href: string;
  label: string;
  /** The rail tile's short word (§1.2); a top tile without one shows the full label. */
  short?: string;
  /** Top-level item: a tile in the rail, a row in the panel. Rows inside a group list are never tiles. */
  tile?: boolean;
  active?: boolean;
  look?: BadgeLook | null;
  tone?: BadgeValueLike['tone'];
  badgeWords?: string | null;
  viewOnly?: string | null;
  locale: Locale;
  /** Tooltip (rail tiles): title · key chip · meaning. */
  tip?: { title: string; kbd?: string; text?: string } | null;
  onNavigate?: () => void;
}

/** A nav link: a row in the panel and in a flyout, a labelled tile in the rail (one DOM, §12). */
export function NavItem({ itemKey, href, label, short, tile = false, active = false, look, tone = 'neutral', badgeWords, viewOnly, locale, tip, onNavigate }: NavItemProps) {
  const { icon, k, mirrored } = iconProps(itemKey);
  return (
    <Link
      href={href}
      data-nav-key={itemKey}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      data-tip={tip?.title}
      data-tip-kbd={tip?.kbd}
      data-tip-text={tip?.text}
      data-tip-when={tip ? 'rail' : undefined}
      className={cn(css.item, tile && css.tile, 'text-sm leading-5', active ? 'font-semibold' : 'font-medium')}
    >
      <span className={css.ic}>
        <NavIcon icon={icon} k={k} mirrored={mirrored} duo={active} />
        {look ? <span aria-hidden="true" data-badge-dot={look.railDot} className={cn(css.railDot, DOT_CLASS[look.railDot])} /> : null}
      </span>
      <span className={css.lab}>{withBrand(label)}</span>
      {tile ? (
        <span aria-hidden="true" className={cn(css.short, 'text-xs leading-4 font-medium')}>
          {short ?? withBrand(label)}
        </span>
      ) : null}
      {badgeWords ? <span className="sr-only">, {badgeWords}</span> : null}
      {viewOnly ? <span className="sr-only">, {viewOnly}</span> : null}
      {look ? <Pill look={look} tone={tone} locale={locale} /> : null}
      {viewOnly ? <Eye aria-hidden="true" width={16} height={16} strokeWidth={1.75} className={css.eye} /> : null}
    </Link>
  );
}
