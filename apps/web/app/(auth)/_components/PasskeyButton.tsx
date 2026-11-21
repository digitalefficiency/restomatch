'use client';

import { KeyRound } from 'lucide-react';
import { signIn } from 'next-auth/webauthn';
import { useState } from 'react';
import { Button } from '@/lib/components';

/**
 * W3-07b passkeys (flag): sign in, or — on /passkeys — register this device.
 * The browser shows its own Face ID / fingerprint / PIN prompt; the server
 * (Auth.js WebAuthn + auth.ts signIn callback) decides whether it is allowed.
 */
export function PasskeyButton({
  mode,
  label,
  failedLabel,
  callbackUrl,
}: {
  mode: 'signin' | 'register';
  label: string;
  failedLabel: string;
  callbackUrl: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        loading={busy}
        className="min-h-12 w-full text-base"
        data-testid={`passkey-${mode}`}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await signIn('passkey', mode === 'register' ? { action: 'register', callbackUrl } : { callbackUrl });
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {failedLabel}
        </p>
      ) : null}
    </div>
  );
}
