import { notFound } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { auth } from '@/auth';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { ingest } from '@/lib/i18n/messages/ingest';
import { createServerCaller } from '@/lib/trpc/server';
import { InboxClient, type InboxMessage } from './inbox-client';

export const dynamic = 'force-dynamic';

/**
 * Invoice inbox (flags ingestWhatsapp / ingestEmail): documents received by
 * WhatsApp / e-mail with their status and errors, the secret receiving
 * addresses, and the sender allow-list. A disabled feature is invisible (404).
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: rawFilter } = await searchParams;
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
  const [messages, senders, suppliers, t] = await Promise.all([
    caller.ingest.inbox({ filter, limit: 50 }),
    caller.ingest.senders(),
    caller.suppliers.list().catch(() => []),
    getT(ingest),
  ]);
  const role = session?.user?.role ?? null;

  return (
    <div>
      <SectionHeader title={t('inbox.title')} subtitle={t('inbox.subtitle')} />
      <InboxClient
        filter={filter}
        canManage={role === 'owner' || role === 'manager'}
        features={overview.features}
        needsReview={overview.needsReview}
        channels={overview.channels.map((c) => ({ kind: c.kind, tokenHint: c.tokenHint, phoneNumberId: c.phoneNumberId }))}
        senders={senders.map((s) => ({
          id: s.id,
          kind: s.kind,
          sender: s.sender,
          label: s.label,
          supplierName: s.supplierName ?? null,
        }))}
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
            })),
          }),
        )}
      />
    </div>
  );
}
