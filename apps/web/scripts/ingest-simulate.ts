/**
 * LOCAL DEMO ONLY — fill the invoice inbox through the REAL webhook routes.
 *
 *   DATABASE_URL=postgres://…/restomatch_dev \
 *   WHATSAPP_APP_SECRET=… INGEST_EMAIL_WEBHOOK_SECRET=whsec_… (same values as the server; dev defaults otherwise) \
 *   pnpm --filter @restomatch/web exec tsx scripts/ingest-simulate.ts [http://localhost:3000]
 *
 * Creates fresh WhatsApp + e-mail channels for the seeded demo restaurant
 * (owner DB connection — this is a seed step), allow-lists one supplier
 * number, then POSTs signed, stub-provider webhooks: an allow-listed WhatsApp
 * photo (→ invoice, OCR job), an unknown WhatsApp sender (→ needs review), an
 * unknown e-mail with a PDF (→ needs review) and a disguised HTML "invoice"
 * (→ rejected). Refuses to run against a non-local DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  DEV_EMAIL_WEBHOOK_SECRET,
  DEV_WHATSAPP_APP_SECRET,
  generateIngestToken,
  hashIngestToken,
  signMeta,
  signStandardWebhook,
  tokenHint,
} from '@restomatch/ingest';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || !/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error('[ingest-simulate] DATABASE_URL must point at a LOCAL database');
  process.exit(1);
}
const waSecret = process.env.WHATSAPP_APP_SECRET || DEV_WHATSAPP_APP_SECRET;
const emailSecret = process.env.INGEST_EMAIL_WEBHOOK_SECRET || DEV_EMAIL_WEBHOOK_SECRET;
const domain = process.env.INGEST_EMAIL_DOMAIN || 'in.restomatch.local';
const sql = postgres(dbUrl, { max: 1 });

async function main() {
  const [r] = await sql<{ id: string }[]>`select id from restaurants where name = 'כפר הזיתים' limit 1`;
  if (!r) throw new Error('demo restaurant not found — run the seed first');
  const [sup] = await sql<{ id: string; name: string }[]>`
    select id, name from suppliers where restaurant_id = ${r.id} order by name limit 1`;
  const tokens = { whatsapp: generateIngestToken('whatsapp'), email: generateIngestToken('email') };
  for (const kind of ['whatsapp', 'email'] as const) {
    await sql`update ingest_channels set active = false, revoked_at = now()
              where restaurant_id = ${r.id} and kind = ${kind} and active`;
    await sql`insert into ingest_channels (restaurant_id, kind, token_hash, token_hint, phone_number_id)
              values (${r.id}, ${kind}, ${hashIngestToken(tokens[kind])}, ${tokenHint(tokens[kind])},
                      ${kind === 'whatsapp' ? '1000000001' : null})`;
  }
  await sql`insert into ingest_senders (restaurant_id, kind, sender, supplier_id, label)
            values (${r.id}, 'whatsapp', '972501234567', ${sup?.id ?? null}, 'נהג / driver')
            on conflict (restaurant_id, kind, sender) do nothing`;

  const now = Math.floor(Date.now() / 1000);
  const wa = (from: string, caption: string) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-DEMO',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '1000000001' },
                messages: [
                  {
                    from,
                    id: `wamid.${randomUUID()}`,
                    timestamp: String(now),
                    type: 'image',
                    image: { id: `media-${randomUUID()}`, mime_type: 'image/jpeg', caption },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  const email = (from: string, subject: string, filename: string, content: Buffer) =>
    JSON.stringify({
      type: 'email.received',
      data: {
        email_id: `em_${randomUUID()}`,
        from,
        to: [`${tokens.email}@${domain}`],
        subject,
        attachments: [{ filename, content_type: 'application/pdf', content: content.toString('base64') }],
      },
    });

  const post = async (label: string, url: string, body: string, headers: Record<string, string>) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    console.log(`[ingest-simulate] ${label}: HTTP ${res.status} ${await res.text()}`);
  };
  const waUrl = `${base}/api/ingest/whatsapp/${tokens.whatsapp}`;
  for (const [label, body] of [
    ['whatsapp allow-listed', wa('972501234567', `חשבונית ${sup?.name ?? ''}`)],
    ['whatsapp unknown sender', wa('972541112233', 'invoice from new driver')],
  ] as const) {
    await post(label, waUrl, body, { 'x-hub-signature-256': signMeta(body, waSecret) });
  }
  const emailUrl = `${base}/api/ingest/email`;
  for (const [label, body] of [
    ['email unknown sender (pdf)', email('Billing <billing@new-supplier.co.il>', 'חשבונית מס 10442', 'invoice-10442.pdf', Buffer.from(`%PDF-1.4\n% demo ${randomUUID()}\n`))],
    ['email disguised html', email('promo@spam.example', 'Your invoice', 'invoice.pdf', Buffer.from('<html><script>alert(1)</script></html>'))],
  ] as const) {
    const id = `msg_${randomUUID()}`;
    await post(label, emailUrl, body, {
      'webhook-id': id,
      'webhook-timestamp': String(now),
      'webhook-signature': signStandardWebhook({ id, timestampSec: now, body, secret: emailSecret }),
    });
  }
  // A forged delivery must bounce.
  const forged = wa('972501234567', 'forged');
  await post('whatsapp FORGED signature', waUrl, forged, { 'x-hub-signature-256': signMeta(forged, 'wrong') });
  console.log(`[ingest-simulate] e-mail address: ${tokens.email}@${domain}`);
}

main()
  .catch((err) => {
    console.error('[ingest-simulate] failed', err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
