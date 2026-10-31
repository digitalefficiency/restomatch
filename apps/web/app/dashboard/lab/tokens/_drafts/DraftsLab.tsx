'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, Field, InlineMessage, Input, PrintButton, Sheet, StatusChip, Textarea, useAnnounce } from '@/lib/components';
import { useLocale } from '@/lib/i18n/client';
import { DraftScopeProvider, useFormDraft, useLeaveGuard, useSaveShortcut, type DraftScope, type LeaveTarget } from '@/lib/drafts';
import { draftsLabEn, draftsLabHe } from './copy';

interface LabForm {
  note: string;
  qty: string;
}

const EMPTY: LabForm = { note: '', qty: '' };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function DraftsLab({ scope }: { scope: DraftScope | null }) {
  return (
    <DraftScopeProvider scope={scope}>
      <DraftsLabBody hasScope={!!scope} />
    </DraftScopeProvider>
  );
}

function DraftsLabBody({ hasScope }: { hasScope: boolean }) {
  const locale = useLocale();
  const c = locale === 'he' ? draftsLabHe : draftsLabEn;
  const announce = useAnnounce();
  // The working copy (what is typed) and the "server" copy (what was saved).
  // The lab has no server, so the saved copy is a second device draft.
  const draft = useFormDraft<LabForm>('lab:drafts:working', EMPTY, { version: 1, ttlMs: WEEK_MS });
  const saved = useFormDraft<LabForm>('lab:drafts:saved', EMPTY, { version: 1 });
  const dirty = draft.hydrated && saved.hydrated && (draft.value.note !== saved.value.note || draft.value.qty !== saved.value.qty);
  const [asking, setAsking] = useState<LeaveTarget | null>(null);
  const { leave } = useLeaveGuard(dirty, setAsking);

  const save = () => {
    if (!dirty) return;
    saved.setValue(draft.value);
    announce(c.saved);
  };
  useSaveShortcut(save);

  const set = (patch: Partial<LabForm>) => draft.setValue((v) => ({ ...v, ...patch }));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-h2 font-bold text-ink">{c.title}</h1>
        <p className="text-body text-muted">{c.intro}</p>
      </header>

      {!hasScope && <InlineMessage tone="warn">{c.noScope}</InlineMessage>}
      {draft.restored && dirty && (
        <InlineMessage tone="info">
          {c.restored}
        </InlineMessage>
      )}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span data-testid="drafts-state" data-dirty={dirty ? 'true' : 'false'}>
            <StatusChip tone={dirty ? 'warn' : 'success'} label={dirty ? c.unsaved : c.allSaved} />
          </span>
          <Link href="/dashboard/lab/desk" className="text-body-sm font-semibold text-primary underline-offset-4 hover:underline">
            {c.leaveTest}
          </Link>
        </div>
        <Field label={c.noteLabel} htmlFor="lab-note" hint={c.noteHint}>
          <Textarea id="lab-note" rows={4} value={draft.value.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <Field label={c.qtyLabel} htmlFor="lab-qty">
          <Input id="lab-qty" inputMode="decimal" value={draft.value.qty} onChange={(e) => set({ qty: e.target.value })} />
        </Field>
        <p className="text-body-sm text-muted">{c.shortcut}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={!dirty}>
            {c.save}
          </Button>
          <Button variant="secondary" onClick={() => draft.setValue(saved.value)} disabled={!dirty}>
            {c.discard}
          </Button>
        </div>
      </Card>

      <section data-print-root="lab-sheet" className="space-y-2 rounded-lg border border-line bg-surface p-4" aria-labelledby="lab-sheet-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lab-sheet-title" className="text-h4 font-bold text-ink">
            {c.printTitle}
          </h2>
          <PrintButton label={c.print} scope="lab-sheet" />
        </div>
        <p className="text-body text-muted">{c.printBody}</p>
        <p className="whitespace-pre-wrap text-body text-ink">{saved.value.note}</p>
      </section>

      <Sheet
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={c.leaveTitle}
        description={c.leaveBody}
        primary={
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="primary" size="xl" onClick={() => setAsking(null)}>
              {c.stay}
            </Button>
            <Button
              variant="secondary"
              size="xl"
              onClick={() => {
                const target = asking;
                setAsking(null);
                if (target) leave(target);
              }}
            >
              {c.leave}
            </Button>
          </div>
        }
      />
    </div>
  );
}
