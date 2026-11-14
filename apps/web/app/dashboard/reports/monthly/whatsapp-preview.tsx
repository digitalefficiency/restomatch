/**
 * The WhatsApp bubble of "כך זה נשלח" (W3-08). WhatsApp lays a message out by
 * its own language (first strong character), not by the app around it, so the
 * bubble's direction follows the MESSAGE locale: a Hebrew/Arabic message is RTL
 * ("‏533 ‏₪" shows the ₪ left of the digits, as on the phone), an English one
 * LTR ("₪533"). The text itself (moneyText via the report copy) is never
 * touched here.
 */
const RTL_LOCALES = new Set(['he', 'ar']);

export function bubbleDir(locale: string): 'rtl' | 'ltr' {
  return RTL_LOCALES.has(locale.split('-')[0]!.toLowerCase()) ? 'rtl' : 'ltr';
}

export function WhatsAppPreview({ text, locale }: { text: string; locale: string }) {
  const dir = bubbleDir(locale);
  return (
    <pre
      dir={dir}
      lang={locale}
      className="mt-3 max-w-md whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-surface-2 p-4 text-start font-sans text-sm leading-relaxed text-ink"
      data-testid="report-whatsapp"
      data-dir={dir}
    >
      {text}
    </pre>
  );
}
