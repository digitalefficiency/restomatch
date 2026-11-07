import Link from 'next/link';
import { LEGAL_LINKS } from './registry';

/**
 * The one legal-link list (G-11). Every shell renders this: same links, same
 * order (`LEGAL_LINKS`). Variants change LAYOUT only, never membership or order.
 *
 * Server- AND client-safe: no hooks, no context, no `next/navigation`.
 * - `footer-column`: a vertical list for a footer column (marketing).
 * - `inline-row`: a wrapping row with `·` separators (legal pages, sign-in,
 *   supplier portal, showcase, admin, error page, trust strip).
 * - `plain`: bare `<a>` + inline styles, for `global-error` (no providers, no
 *   component chunks, maybe no stylesheet).
 *
 * `locale` is the BASE locale: anything but 'he' renders English, the same
 * fallback receiver locales (ar/ru/th/ti) get everywhere else.
 */
export type LegalLinksVariant = 'footer-column' | 'inline-row' | 'plain';

const ITEM: Record<Exclude<LegalLinksVariant, 'plain'>, string> = {
  'footer-column': 'flex flex-col gap-2',
  'inline-row': 'flex flex-wrap items-center gap-x-1',
};

const LINK_TONE = {
  muted: 'text-muted hover:text-ink',
  primary: 'font-medium text-primary',
} as const;

export function LegalLinks({
  locale,
  variant,
  tone = 'muted',
  align = 'center',
  className,
}: {
  locale: string;
  variant: LegalLinksVariant;
  /** Link colour only (the trust strip uses primary). */
  tone?: keyof typeof LINK_TONE;
  /** `inline-row` only: centred (default) or flush to the start edge. */
  align?: 'center' | 'start';
  className?: string;
}) {
  const lang = locale === 'he' ? 'he' : 'en';

  if (variant === 'plain') {
    return (
      <ul
        data-legal-links="plain"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0 0.25rem',
          fontSize: '0.875rem',
        }}
        className={className}
      >
        {LEGAL_LINKS.map((l) => (
          <li key={l.id}>
            <a
              href={l.href}
              data-legal-id={l.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: '44px',
                padding: '0 0.5rem',
                color: 'rgb(var(--c-muted, 74 93 83))',
                textDecoration: 'underline',
                textUnderlineOffset: '4px',
              }}
            >
              {l.label[lang]}
            </a>
          </li>
        ))}
      </ul>
    );
  }

  const row = variant === 'inline-row';
  return (
    <ul data-legal-links={variant} className={[ITEM[variant], row ? (align === 'start' ? 'justify-start' : 'justify-center') : '', 'text-sm', className].filter(Boolean).join(' ')}>
      {LEGAL_LINKS.map((l, i) => (
        <li key={l.id} className={row ? 'inline-flex items-center gap-x-1' : undefined}>
          {row && i > 0 ? (
            <span aria-hidden="true" className="text-subtle">
              ·
            </span>
          ) : null}
          <Link
            href={l.href}
            data-legal-id={l.id}
            className={[
              'touch-target inline-flex items-center rounded underline-offset-4',
              row ? 'px-2 hover:underline' : '',
              LINK_TONE[tone],
              tone === 'primary' ? 'hover:underline' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {l.label[lang]}
          </Link>
        </li>
      ))}
    </ul>
  );
}
