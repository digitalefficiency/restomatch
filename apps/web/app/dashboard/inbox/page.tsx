import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { auth } from '@/auth';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { ingest } from '@/lib/i18n/messages/ingest';
import { createServerCaller } from '@/lib/trpc/server';
import Link from 'next/link';
import { InboxClient, type InboxMessage } from './inbox-client';
import { IntakeSettings } from './intake-settings-client';

export const dynamic = 'force-dynamic';

/**
 * Invoice inbox (flags ingestWhatsapp / ingestEmail): documents received by
 * WhatsApp / e-mail with their status and errors, the secret receiving
 * addresses, and the sender allow-list. A disabled feature is invisible (404).
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; view?: string }>;
}) {
  const { filter: rawFilter, view } = await searchParams;
  const filter = rawFilter === 'needs_review' || rawFilter === 'errors' ? rawFilter : 'all';
  const caller = await createServerCaller();
  const session = await auth();
  let overview;
  try {
    overview = await caller.ingest.overview();
  } catch (err) {
    if (err instanceof TRPCError && (err.code === 'FORBIDDEN' || err.code === 'NOT_FOUND')) notFound();
    throw err;
  }
  const role = session?.user?.role ?? null;
  if (view === 'settings') {
    // W2-02 (approvals-35): intake addresses + approved senders, off the queue. W2-14's settings link here.
    const [senders, suppliers, t] = await Promise.all([caller.ingest.senders(), caller.suppliers.list().catch(() => []), getT(ingest)]);
    const kinds = (['whatsapp', 'email'] as const).filter((k) => overview.features[k]);
    return (
      <div>
        <Link href="/dashboard/inbox" className="mb-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
          {t('intakeSettings.back')}
        </Link>
        <SectionHeader level={1} title={t('intakeSettings.title')} subtitle={t('intakeSettings.subtitle')} />
        <IntakeSettings
          canManage={role === 'owner' || role === 'manager'}
          kinds={[...kinds]}
          channels={overview.channels.map((c) => ({ kind: c.kind, tokenHint: c.tokenHint, phoneNumberId: c.phoneNumberId }))}
          senders={senders.map((s) => ({ id: s.id, kind: s.kind, sender: s.sender, label: s.label, supplierName: s.supplierName ?? null }))}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn ?? null }))}
        />
      </div>
    );
  }
  const [messages, suppliers, t] = await Promise.all([
    caller.ingest.inbox({ filter, limit: 50 }),
    // The supplier picker is a convenience: without it a document still goes to OCR unassigned.
    caller.suppliers.list().catch(() => []),
    getT(ingest),
  ]);

  return (
    <div>
      <SectionHeader level={1} title={t('inbox.title')} subtitle={t('inbox.subtitle')} />
      <InboxClient
        filter={filter}
        // G-07 intake.approve: owner, manager and bookkeeper approve intake (functional-flows-07).
        canManage={role === 'owner' || role === 'manager' || role === 'bookkeeper'}
        features={overview.features}
        needsReview={overview.needsReview}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn ?? null }))}
        messages={messages.map(
          (m): InboxMessage => ({
            id: m.id,
            kind: m.kind,
            sender: m.sender,
            senderAllowed: m.senderAllowed,
            subject: m.subject,
            status: m.status,
            error: m.error,
            receivedAt: new Date(m.receivedAt).toISOString(),
            supplierName: m.supplierName ?? null,
            order: m.order ?? null,
            documents: m.documents.map((d) => ({
              id: d.id,
              filename: d.filename,
              mimeType: d.mimeType,
              sizeBytes: d.sizeBytes,
              status: d.status,
              error: d.error,
              invoiceId: d.invoiceId,
              stored: d.stored,
              ocr: d.ocr ?? null,
            })),
          }),
        )}
      />
    </div>
  );
}
