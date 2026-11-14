import { expect, test } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * AU-03 (A12) · credit-request recovery, the two digest links end to end (orchestrator 14.11, (a)–(d)):
 *
 *   1. "הכנת תזכורת" in the 08:30 digest → /dashboard/go → the desk's reminder drafts
 *      (`?tab=track&remind=1#reminder-drafts`). The draft for our supplier names ONLY the
 *      claim whose letter went out 12 days ago (₪30.00) — never the unsent request
 *      (claimed, no letter, ₪99.99) nor the fresh letter (2 days). WhatsApp opens
 *      wa.me with E.164 digits (052… → 97252…). Opening the draft queues nothing.
 *   2. "זיכויים שמחכים לאישור" → the desk's credit-line card (`#credit-suggestions`):
 *      "סגירה עם השורה" on the supplier's ₪20.00 credit line → "הצעת שיוך" (W3-11's one
 *      engine) proposes the exact ₪20.00 request → "אשר שיוך" books exactly that claim.
 *
 * The spec makes its own supplier, invoices and claims (never the demo seed's rows) and
 * removes them afterwards; audit_log is append-only, so its rows stay.
 */
test.use({ storageState: OWNER_STATE });

const SUPPLIER = 'AU-03 ספק בדיקה';
const BASE_INVOICE = 'AU03-E2E-BASE';
const CREDIT_INVOICE = 'AU03-E2E-CR';
const DESK_REMINDERS_PATH = '/dashboard/recovery?tab=track&remind=1#reminder-drafts';
const DESK_CREDIT_SUGGESTIONS_PATH = '/dashboard/recovery?tab=track#credit-suggestions';

let restaurantId = '';
let supplierId = '';
const invoiceIds: string[] = [];
const discrepancyIds: string[] = [];
const claim = { overdue: '', unsent: '', fresh: '' };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const go = (to: string) => `/dashboard/go?r=${restaurantId}&to=${encodeURIComponent(to)}`;

async function outboxCount(): Promise<number> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from notifications_outbox where restaurant_id = ${restaurantId}`;
    return r?.n ?? 0;
  } finally {
    await sql.end();
  }
}

test.describe('AU-03 · digest links land on the right desk row', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const sql = e2eSql();
    try {
      const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
      restaurantId = r!.id;
      const [s] = await sql<{ id: string }[]>`
        insert into suppliers (restaurant_id, name, contact_whatsapp, contact_email)
        values (${restaurantId}, ${SUPPLIER}, '052-123-4567', 'office@au03.test') returning id`;
      supplierId = s!.id;
      const [base] = await sql<{ id: string }[]>`
        insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, total_excl_vat, vat_amount, status, source)
        values (${restaurantId}, ${supplierId}, ${BASE_INVOICE}, ${daysAgo(15)}, '500.00', '90.00', 'matched', 'photo') returning id`;
      invoiceIds.push(base!.id);
      const [run] = await sql<{ id: string }[]>`
        insert into match_runs (restaurant_id, invoice_id, overall_status, total_discrepancy_amount)
        values (${restaurantId}, ${base!.id}, 'major', '149.99') returning id`;
      const mk = async (agorot: number, status: string, letterDaysAgo: number | null, claimedDaysAgo: number) => {
        const [d] = await sql<{ id: string }[]>`
          insert into discrepancies (match_run_id, restaurant_id, type, severity, delta_amount, resolution_status)
          values (${run!.id}, ${restaurantId}, 'PRICE_HIGHER', 'block', ${(agorot / 100).toFixed(2)}, 'accepted') returning id`;
        discrepancyIds.push(d!.id);
        const [c] = await sql<{ id: string }[]>`
          insert into recovery_claims (restaurant_id, discrepancy_id, supplier_id, invoice_id, amount_agorot, status, claimed_at, letter_sent_at)
          values (${restaurantId}, ${d!.id}, ${supplierId}, ${base!.id}, ${agorot}, ${status},
                  ${daysAgo(claimedDaysAgo)}, ${letterDaysAgo == null ? null : daysAgo(letterDaysAgo)})
          returning id`;
        return c!.id;
      };
      claim.overdue = await mk(3_000, 'letter_sent', 12, 13);
      claim.unsent = await mk(9_999, 'claimed', null, 12);
      claim.fresh = await mk(2_000, 'letter_sent', 2, 3);
      // A later invoice of the same supplier carrying the ₪20.00 credit line.
      const [cr] = await sql<{ id: string }[]>`
        insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, total_excl_vat, vat_amount, status, source)
        values (${restaurantId}, ${supplierId}, ${CREDIT_INVOICE}, ${daysAgo(0)}, '0.00', '0.00', 'matched', 'photo') returning id`;
      invoiceIds.push(cr!.id);
      await sql`
        insert into invoice_lines (invoice_id, raw_description, qty_billed, unit, unit_price_billed, line_total)
        values (${cr!.id}, 'זיכוי', '1', 'unit', '-20.00', '-20.00')`;
    } finally {
      await sql.end();
    }
  });

  test.afterAll(async () => {
    const sql = e2eSql();
    try {
      if (supplierId) {
        await sql`delete from recovery_events where claim_id in (select id from recovery_claims where supplier_id = ${supplierId})`;
        await sql`delete from recovery_claims where supplier_id = ${supplierId}`;
        await sql`delete from credit_notes where supplier_id = ${supplierId}`;
      }
      if (discrepancyIds.length) await sql`delete from discrepancies where id in ${sql(discrepancyIds)}`;
      if (invoiceIds.length) {
        await sql`delete from match_runs where invoice_id in ${sql(invoiceIds)}`;
        await sql`delete from invoice_lines where invoice_id in ${sql(invoiceIds)}`;
        await sql`delete from invoices where id in ${sql(invoiceIds)}`;
      }
      if (supplierId) await sql`delete from suppliers where id = ${supplierId}`;
    } finally {
      await sql.end();
    }
  });

  test('"הכנת תזכורת" → the reminder draft: only the sent, 7+ day claim; E.164 WhatsApp; nothing queued', async ({ page }) => {
    const errors = collectPageErrors(page);
    const before = await outboxCount();
    await page.goto(go(DESK_REMINDERS_PATH));
    await expect(page).toHaveURL(/\/dashboard\/recovery\?tab=track&remind=1#reminder-drafts$/);
    const drafts = page.getByTestId('reminder-drafts');
    await expect(drafts).toBeVisible({ timeout: 30_000 });
    const row = drafts.getByTestId('reminder-draft').filter({ hasText: SUPPLIER });
    await expect(row).toHaveCount(1);
    // ₪30.00 (the 12-day letter) — never ₪99.99 (no letter yet) nor ₪20.00 (2-day letter).
    await expect(row).toContainText('30.00');
    await expect(row).not.toContainText('99.99');
    await expect(row).not.toContainText('129.99');
    await expect(row).not.toContainText('50.00');
    const wa = await row.getByTestId('reminder-whatsapp').getAttribute('href');
    expect(wa).toMatch(/^https:\/\/wa\.me\/972521234567\?text=/);
    for (const w of ['דרישה', 'תביעה', 'חוב', 'באיחור', 'מחלוקת']) expect(decodeURIComponent(wa!.split('text=')[1] ?? '')).not.toContain(w);
    expect(await outboxCount()).toBe(before);
    expect(errors).toEqual([]);
  });

  test('"זיכויים שמחכים לאישור" → the credit line: one-engine proposal, confirm books exactly that claim', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(go(DESK_CREDIT_SUGGESTIONS_PATH));
    await expect(page).toHaveURL(/\/dashboard\/recovery\?tab=track#credit-suggestions$/);
    const card = page.locator('#credit-suggestions');
    await expect(card).toBeVisible({ timeout: 30_000 });
    const line = card.locator('li').filter({ hasText: CREDIT_INVOICE });
    await expect(line).toContainText('20.00');
    await line.getByRole('button', { name: 'סגירה עם השורה' }).click();
    const form = page.locator(`#credit-${supplierId}`).getByTestId('credit-form');
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'הצעת שיוך' }).click();
    await expect(form.getByTestId('allocation-basis')).toContainText('הסכום תואם בקשת זיכוי אחת בדיוק');
    await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(1);
    await form.getByRole('button', { name: 'אשר שיוך' }).click();

    const sql = e2eSql();
    try {
      await expect
        .poll(async () => {
          const [c] = await sql<{ status: string; credited: number }[]>`
            select status, credited_agorot::int as credited from recovery_claims where id = ${claim.fresh}`;
          return c ? `${c.status}:${c.credited}` : '';
        }, { timeout: 15_000 })
        .toBe('credited:2000');
      const rest = await sql<{ id: string; status: string; credited: number }[]>`
        select id, status, credited_agorot::int as credited from recovery_claims where id in ${sql([claim.overdue, claim.unsent])}`;
      for (const r of rest) expect(r.credited, r.id).toBe(0);
      expect(rest.find((r) => r.id === claim.overdue)!.status).toBe('letter_sent');
      expect(rest.find((r) => r.id === claim.unsent)!.status).toBe('claimed');
    } finally {
      await sql.end();
    }
    expect(errors).toEqual([]);
  });
});
