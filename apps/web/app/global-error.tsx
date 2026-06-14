'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Global error boundary — replaces the ROOT layout when an error is thrown in it.
 * Must render its own <html>/<body>. Kept dependency-free (inline styles) so it
 * renders even if component/styling chunks failed to load. "Command center for
 * money" dark palette, set inline (it replaces the root layout's dark canvas).
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

  return (
    <html lang="he" dir="rtl">
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
          color: '#ECF5EF',
          background:
            'radial-gradient(ellipse 90% 55% at 50% -10%, rgba(34,211,154,0.06), transparent 60%), #0E1512',
        }}
      >
        <div
          style={{
            position: 'relative',
            maxWidth: '28rem',
            width: '100%',
            textAlign: 'center',
            overflow: 'hidden',
            background: '#16201B',
            border: '1px solid #2A3A31',
            borderRadius: '1rem',
            padding: '2rem',
            boxShadow:
              '0 0 0 1px rgba(255,92,122,0.20), 0 14px 34px -18px rgba(0,0,0,0.66)',
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
                'linear-gradient(90deg, rgba(255,92,122,0) 0%, #FF5C7A 50%, rgba(255,92,122,0) 100%)',
            }}
          />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem', color: '#ECF5EF' }}>
            משהו השתבש
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#9DB2A6', margin: '0 0 1.5rem' }}>
            נתקלנו בתקלה בלתי צפויה. נסו לטעון מחדש את העמוד.
          </p>
          {error.digest ? (
            <p
              style={{
                fontSize: '0.75rem',
                color: '#6B8478',
                margin: '0 0 1.5rem',
                fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              קוד שגיאה: {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '0.75rem',
              background: '#22D39A',
              color: '#07120D',
              fontSize: '0.875rem',
              fontWeight: 600,
              padding: '0.625rem 1.25rem',
              boxShadow:
                '0 0 0 1px rgba(34,211,154,0.22), 0 12px 36px -10px rgba(34,211,154,0.22)',
            }}
          >
            נסו שוב
          </button>
        </div>
      </body>
    </html>
  );
}
