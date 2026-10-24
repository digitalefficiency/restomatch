'use client';

import { useEffect } from 'react';
import { dirOf, localeFromCookieHeader } from '@/lib/i18n/config';
import './globals.css';

/**
 * Global error boundary — replaces the ROOT layout when an error is thrown in it.
 * Must render its own <html>/<body>. Kept dependency-free (inline styles) so it
 * renders even if component/styling chunks failed to load. "Command center for
 * money" light palette, set inline (it replaces the root layout's canvas).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // No providers here (this replaces the root layout) — read the cookie directly.
  const locale = localeFromCookieHeader(typeof document === 'undefined' ? null : document.cookie);
  const en = locale === 'en';

  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4rem 1.5rem',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Rubik, Arial, sans-serif',
          color: '#0F1F17',
          background:
            'radial-gradient(ellipse 90% 55% at 50% -10%, rgba(6,107,74,0.05), transparent 60%), #F6F8F7',
        }}
      >
        <div
          style={{
            position: 'relative',
            maxWidth: '28rem',
            width: '100%',
            textAlign: 'center',
            overflow: 'hidden',
            background: '#FFFFFF',
            border: '1px solid #D3DDD7',
            borderRadius: '1rem',
            padding: '2rem',
            boxShadow:
              '0 0 0 1px rgba(184,15,42,0.25), 0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.12)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              insetInline: 0,
              top: 0,
              height: '2px',
              background:
                'linear-gradient(90deg, rgba(184,15,42,0) 0%, #B80F2A 50%, rgba(184,15,42,0) 100%)',
            }}
          />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem', color: '#0F1F17' }}>
            {en ? 'Something went wrong' : 'משהו השתבש'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#4A5D53', margin: '0 0 1.5rem' }}>
            {en
              ? 'We hit an unexpected error. Try reloading the page.'
              : 'נתקלנו בתקלה בלתי צפויה. נסו לטעון מחדש את העמוד.'}
          </p>
          {error.digest ? (
            <p
              style={{
                fontSize: '0.75rem',
                color: '#5A6A62',
                margin: '0 0 1.5rem',
                fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {en ? 'Error code' : 'קוד שגיאה'}: {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '0.75rem',
              background: '#066B4A',
              color: '#FFFFFF',
              fontSize: '0.875rem',
              fontWeight: 600,
              padding: '0.625rem 1.25rem',
              boxShadow:
                '0 1px 2px rgba(15,31,23,0.06), 0 8px 24px -12px rgba(15,31,23,0.14)',
            }}
          >
            {en ? 'Try again' : 'נסו שוב'}
          </button>
        </div>
      </body>
    </html>
  );
}
