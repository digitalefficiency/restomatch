import { LEGAL_LINKS } from './registry';

/**
 * The `plain` legal list (G-11): bare `<a>` + inline styles, importing ONLY the
 * zero-import registry, so `app/global-error.tsx` (outside every provider, maybe
 * without component chunks or the stylesheet) can always render it. Same ids,
 * same order as `LegalLinks`.
 */
export function LegalLinksPlain({ locale, className }: { locale: string; className?: string }) {
  const lang = locale === 'he' ? 'he' : 'en';
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
