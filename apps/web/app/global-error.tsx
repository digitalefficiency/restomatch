'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Global error boundary — replaces the ROOT layout when an error is thrown in it.
 * Must render its own <html>/<body>. Kept dependency-free (inline styles) so it
 * renders even if component/styling chunks failed to load. Ledger palette.
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
          color: '#15201a',
          background: 'linear-gradient(180deg, #faf9f5 0%, #f1efe8 100%)',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            textAlign: 'center',
            background: '#fff',
            border: '1px solid rgba(214,211,209,0.8)',
            borderRadius: '1rem',
            padding: '2rem',
            boxShadow: '0 10px 30px -12px rgba(20,32,26,0.18)',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            משהו השתבש
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#78716c', margin: '0 0 1.5rem' }}>
            נתקלנו בתקלה בלתי צפויה. נסו לטעון מחדש את העמוד.
          </p>
          {error.digest ? (
            <p style={{ fontSize: '0.75rem', color: '#a8a29e', margin: '0 0 1.5rem' }}>
              קוד שגיאה: {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '0.75rem',
              background: '#0b5e4a',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 500,
              padding: '0.625rem 1.25rem',
            }}
          >
            נסו שוב
          </button>
        </div>
      </body>
    </html>
  );
}
