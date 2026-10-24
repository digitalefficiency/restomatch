'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileUp, Loader2, ShieldCheck } from 'lucide-react';
import { Field, Input } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { leakCheck } from '@/lib/i18n/messages/leakCheck';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Photos are downscaled in the browser so 10 phone shots fit one ~4 MB request. */
const MAX_IMAGE_EDGE = 1800;
const TOTAL_BUDGET = 4_300_000;

type Phase = 'idle' | 'challenge' | 'pow' | 'upload';

async function sha256Bits(salt: string, nonce: number): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`${salt}:${nonce}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Proof of work: find a nonce whose SHA-256(salt:nonce) has `bits` leading zero bits. */
async function solve(salt: string, bits: number): Promise<string> {
  for (let n = 0; ; n++) {
    if (leadingZeroBits(await sha256Bits(salt, n)) >= bits) return String(n);
  }
}

/** Re-encode a large photo as JPEG at most MAX_IMAGE_EDGE px; PDFs and small files pass through. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 700_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

const ERROR_KEYS = {
  no_files: 'noFiles',
  too_many_files: 'tooMany',
  file_too_large: 'tooLarge',
  body_too_large: 'tooLarge',
  bad_file_type: 'badType',
  invalid_email: 'email',
  rate_limited: 'rateLimited',
  budget_exhausted: 'budget',
  ocr_failed: 'ocr',
} as const;

export function LeakCheckForm() {
  const t = useT(leakCheck);
  const [files, setFiles] = useState<File[]>([]);
  const [priceList, setPriceList] = useState<File | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== 'idle';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (files.length === 0) return setError(t('form.errors.noFiles'));
    if (files.length > MAX_FILES) return setError(t('form.errors.tooMany'));
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('form.errors.email'));
    try {
      setPhase('challenge');
      const shrunk = await Promise.all(files.map(shrink));
      const all = priceList ? [...shrunk, priceList] : shrunk;
      if (all.some((f) => f.size > MAX_FILE_BYTES) || all.reduce((a, f) => a + f.size, 0) > TOTAL_BUDGET) {
        setPhase('idle');
        return setError(t('form.errors.tooLarge'));
      }
      const cRes = await fetch('/api/leak-check/challenge', { method: 'POST' });
      if (cRes.status === 429) throw new Error('rate_limited');
      const c = (await cRes.json()) as { ok: boolean; token?: string; salt?: string; bits?: number; error?: string };
      if (!c.ok || !c.token || !c.salt || !c.bits) throw new Error(c.error ?? 'challenge');
      setPhase('pow');
      const nonce = await solve(c.salt, c.bits);

      setPhase('upload');
      const fd = new FormData();
      for (const f of shrunk) fd.append('invoices', f);
      if (priceList) fd.set('priceList', priceList);
      fd.set('email', email.trim());
      fd.set('name', name.trim());
      fd.set('website', website);
      fd.set('powToken', c.token);
      fd.set('powNonce', nonce);
      const res = await fetch('/api/leak-check/submit', { method: 'POST', body: fd });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string | null; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'generic');
      if (!body.token) {
        setPhase('idle');
        return;
      }
      window.location.assign(`/leak-check/result?t=${encodeURIComponent(body.token)}`);
    } catch (err) {
      setPhase('idle');
      const code = err instanceof Error ? err.message : 'generic';
      const key = ERROR_KEYS[code as keyof typeof ERROR_KEYS];
      setError(t(`form.errors.${key ?? 'generic'}`));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative space-y-5 rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
      <Field htmlFor="lc-invoices" label={t('form.invoices')} hint={t('form.invoicesHint')}>
        <label
          htmlFor="lc-invoices"
          className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] px-4 py-6 text-sm font-semibold text-primary transition-colors hover:bg-primary/[0.08] focus-within:ring-2 focus-within:ring-primary/60"
        >
          <FileUp className="h-5 w-5" aria-hidden="true" />
          {files.length > 0 ? t('form.selected', { n: files.length }) : t('form.choose')}
          <input
            id="lc-invoices"
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-describedby="lc-invoices-hint"
            disabled={busy}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES + 1))}
          />
        </label>
      </Field>

      <Field htmlFor="lc-pricelist" label={t('form.priceList')} hint={t('form.priceListHint')}>
        <Input
          id="lc-pricelist"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          aria-describedby="lc-pricelist-hint"
          disabled={busy}
          className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-ink"
          onChange={(e) => setPriceList(e.target.files?.[0] ?? null)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field htmlFor="lc-email" label={t('form.email')}>
          <Input
            id="lc-email"
            type="email"
            dir="ltr"
            required
            maxLength={320}
            autoComplete="email"
            className="h-12"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field htmlFor="lc-name" label={t('form.name')}>
          <Input
            id="lc-name"
            maxLength={200}
            autoComplete="organization"
            className="h-12"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </div>

      {/* Honeypot: off-screen, not focusable — humans never fill it. */}
      <div aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="lc-website">{t('form.honeypot')}</label>
        <input id="lc-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-subtle">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          {t('form.privacy')}{' '}
          <Link href="/privacy" className="text-primary underline underline-offset-2">
            {t('form.privacyLink')}
          </Link>
        </span>
      </p>

      {error ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-base font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-wait disabled:opacity-70"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
        {busy ? t(`form.working.${phase as Exclude<Phase, 'idle'>}`) : t('form.submit')}
      </button>
      <p className="sr-only" aria-live="polite">
        {busy ? t(`form.working.${phase as Exclude<Phase, 'idle'>}`) : ''}
      </p>
    </form>
  );
}
