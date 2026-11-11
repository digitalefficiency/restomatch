'use client';

import { useEffect, useState } from 'react';

/**
 * "Remember me" (W3-07b, auth-13): pre-checked ONLY when the app runs installed
 * (standalone display mode) — a personal phone. In a browser tab, possibly a
 * shared kitchen tablet, it starts unchecked. The user can always change it.
 */
export function RememberMe({ label, name = 'rememberMe' }: { label: string; name?: string }) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.('(display-mode: standalone)').matches) setChecked(true);
  }, []);
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
      <input
        type="checkbox"
        name={name}
        className="h-5 w-5 accent-primary"
        checked={checked}
        onChange={(e) => setChecked(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}
