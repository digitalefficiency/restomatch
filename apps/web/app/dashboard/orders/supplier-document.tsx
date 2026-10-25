'use client';

import { useState } from 'react';
import { FileDown, FileText } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, cn, friendlyError, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';
import { base64ToBytes } from '../integrations/logic';

/**
 * Flag `orderPricesOut`: owner/manager switch for prices on the supplier-facing
 * order. Rendered only when the flag is on; the procedure checks it again.
 */
export function DocumentPricesToggle({ initialShowPrices }: { initialShowPrices: boolean }) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const toast = useToast();
  const [showPrices, setShowPrices] = useState(initialShowPrices);
  const save = trpc.orders.setDocumentSettings.useMutation({
    onSuccess: (r) => {
      setShowPrices(r.showPrices);
      toast.success(t('document.saved'));
    },
    onError: (err) => toast.error(friendlyError(err, tc)),
  });
  return (
    <label className="flex max-w-2xl items-start gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={showPrices}
        disabled={save.isPending}
        onChange={(e) => save.mutate({ showPrices: e.target.checked })}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-primary"
        data-testid="order-prices-toggle"
      />
      <span>
        <span className="font-medium">{t('document.toggleLabel')}</span>
        <span className="block text-xs text-muted">{t('document.toggleHint')}</span>
      </span>
    </label>
  );
}

type Tab = 'email' | 'whatsapp';

function downloadPdfOf(data: { pdfBase64: string; filename: string }) {
  const blob = new Blob([base64ToBytes(data.pdfBase64)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = data.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * The literal priced document (flag `orderPricesOut`) for the wizard's review: the
 * WhatsApp bubble or the e-mail text exactly as it will go, with its PDF — always
 * open, for the channel that will actually be used.
 */
export function InlineDocument({ poId, channel }: { poId: string; channel: 'email' | 'whatsapp' }) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const preview = trpc.orders.documentPreview.useQuery({ poId }, { retry: false, staleTime: 0 });
  return (
    <section aria-labelledby="inline-doc-title" data-testid="order-document-preview" data-kind="priced">
      <h3 id="inline-doc-title" className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <FileText className="h-4 w-4 text-primary" aria-hidden="true" /> {t('preview.title')} ·{' '}
        {t(`document.${channel}`)}
      </h3>
      {preview.error ? (
        <p role="alert" className="text-sm text-danger">
          {t('document.failed')} {friendlyError(preview.error, tc)}
        </p>
      ) : !preview.data ? (
        <div className="h-32 animate-pulse rounded-xl bg-surface-2" aria-busy="true" />
      ) : (
        <>
          <pre
            dir="rtl"
            lang="he"
            className={cn(
              'max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border p-3 font-sans text-sm leading-relaxed text-ink',
              channel === 'whatsapp' ? 'border-primary/30 bg-primary/5' : 'border-line bg-surface-2',
            )}
          >
            {channel === 'email' ? preview.data.emailText : preview.data.whatsappText}
          </pre>
          {channel === 'email' ? (
            <Button size="sm" variant="ghost" className="mt-1 min-h-11" onClick={() => downloadPdfOf(preview.data!)}>
              <FileDown className="h-4 w-4" aria-hidden="true" /> {t('document.downloadPdf')}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * "What the supplier receives" for one PO: email text, WhatsApp text and the PDF.
 * Owner/manager also get the restaurant-wide "prices on supplier orders" setting
 * here, next to its effect (it used to sit on the orders list page).
 */
export function SupplierDocumentPreview({
  poId,
  settings,
}: {
  poId: string;
  settings?: { showPrices: boolean } | null;
}) {
  const t = useT(ordersNs);
  const tc = useT(components);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('email');
  const preview = trpc.orders.documentPreview.useQuery({ poId }, { enabled: open, retry: false, staleTime: 0 });

  function downloadPdf() {
    if (preview.data) downloadPdfOf(preview.data);
  }

  return (
    <Card elevated padding="lg" data-testid="supplier-document" id="supplier-document" className="scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            <FileText className="h-4 w-4 text-primary" aria-hidden="true" /> {t('document.previewTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('document.previewBody')}</p>
        </div>
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('document.hide') : t('document.show')}
        </Button>
      </div>
      {settings ? (
        <div className="mt-4 border-t border-line pt-4">
          <DocumentPricesToggle initialShowPrices={settings.showPrices} />
        </div>
      ) : null}
      {open && (
        <div className="mt-4 space-y-3">
          {preview.error ? (
            <p role="alert" className="text-sm text-danger">
              {t('document.failed')} {friendlyError(preview.error, tc)}
            </p>
          ) : !preview.data ? (
            <div className="h-40 animate-pulse rounded-lg bg-surface-2" aria-busy="true" />
          ) : (
            <>
              {!preview.data.showPrices && <p className="text-xs text-muted">{t('document.pricesHidden')}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="tablist" className="inline-flex rounded-lg border border-line p-0.5">
                  {(['email', 'whatsapp'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={cn(
                        'min-h-11 rounded-md px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        tab === k ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:text-ink',
                      )}
                    >
                      {t(`document.${k}`)}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={downloadPdf}>
                  <FileDown className="h-4 w-4" aria-hidden="true" /> {t('document.downloadPdf')}
                </Button>
              </div>
              <pre
                dir="rtl"
                lang="he"
                role="tabpanel"
                className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-4 font-sans text-sm leading-relaxed text-ink"
              >
                {tab === 'email' ? preview.data.emailText : preview.data.whatsappText}
              </pre>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
