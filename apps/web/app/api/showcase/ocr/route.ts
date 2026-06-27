/**
 * Showcase OCR endpoint — runs real Claude Vision on an uploaded invoice and
 * returns the structured extraction (items, quantities, prices). Synchronous
 * (no worker/queue) so the receiver wizard can show the real invoice contents.
 *
 * Constrained to invoice-scans SIGNED URLs (the bucket is private) to avoid
 * being a generic fetch proxy. We fetch the bytes ourselves and hand Claude
 * base64 (fetchBytes) — Anthropic cannot reliably fetch a private/expiring URL.
 */
import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { ClaudeVision } from '@restomatch/ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface OcrContact {
  role?: string | null;
  name?: string | null;
  phone?: string | null;
}
export interface ContactAlert {
  role: string;
  name: string | null;
  oldPhone: string;
  newPhone: string;
  /** new primary first, then kept-secondary numbers */
  allNumbers: string[];
}

// Module-level pooled client (reused across warm serverless invocations).
let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1, prepare: false });
  }
  return _sql;
}

/**
 * Persist supplier contacts and detect changes. If an agent's phone differs
 * from the stored primary, the old number is DEMOTED to secondary (kept, not
 * deleted), the new becomes primary, the change is logged, and an alert is
 * returned for the manager.
 */
async function reconcileContacts(
  businessId: string | undefined,
  contacts: OcrContact[] | undefined,
): Promise<ContactAlert[]> {
  if (!businessId || !contacts?.length) return [];
  const s = db();
  const alerts: ContactAlert[] = [];
  for (const c of contacts) {
    const phone = c.phone?.trim();
    const role = c.role?.trim();
    if (!phone || !role) continue;
    const rows = await s<
      { primary_phone: string | null; secondary_phones: string[]; history: unknown[]; name: string | null }[]
    >`select primary_phone, secondary_phones, history, name
        from supplier_contacts where business_id=${businessId} and role=${role}`;
    if (rows.length === 0) {
      await s`insert into supplier_contacts (business_id, role, name, primary_phone)
              values (${businessId}, ${role}, ${c.name ?? null}, ${phone})`;
      continue;
    }
    const row = rows[0]!;
    if (!row.primary_phone) {
      await s`update supplier_contacts set primary_phone=${phone}, name=${c.name ?? row.name}, updated_at=now()
              where business_id=${businessId} and role=${role}`;
      continue;
    }
    if (row.primary_phone !== phone) {
      const secondary = Array.from(
        new Set([row.primary_phone, ...(row.secondary_phones ?? [])].filter((p) => p && p !== phone)),
      );
      const history = [
        ...(row.history ?? []),
        { at: new Date().toISOString(), role, oldPhone: row.primary_phone, newPhone: phone, name: c.name ?? row.name },
      ];
      await s`update supplier_contacts
              set primary_phone=${phone}, secondary_phones=${s.json(secondary as never)},
                  history=${s.json(history as never)}, name=${c.name ?? row.name}, updated_at=now()
              where business_id=${businessId} and role=${role}`;
      alerts.push({
        role,
        name: c.name ?? row.name,
        oldPhone: row.primary_phone,
        newPhone: phone,
        allNumbers: [phone, ...secondary],
      });
    }
  }
  return alerts;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
// Private bucket → reads come as signed URLs (/object/sign/...).
const ALLOWED_PREFIX = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/sign/invoice-scans/`
  : '';

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'OCR not configured (missing ANTHROPIC_API_KEY)' },
      { status: 503 },
    );
  }

  let url = '';
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body.url === 'string' ? body.url : '';
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  if (!ALLOWED_PREFIX || !url.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json(
      { ok: false, error: 'url must be a signed invoice-scans URL' },
      { status: 400 },
    );
  }

  try {
    const provider = new ClaudeVision({
      apiKey,
      model: process.env.OCR_CLAUDE_MODEL ?? 'claude-opus-4-8',
      // Private bucket: fetch the bytes server-side, never hand Anthropic the URL.
      fetchBytes: true,
    });
    const result = await provider.extract(url);
    // Persist supplier contacts + detect agent phone changes (best-effort:
    // never fail the OCR response on a contact-store hiccup).
    let contactAlerts: ContactAlert[] = [];
    try {
      contactAlerts = await reconcileContacts(result.supplier?.businessId, result.supplier?.contacts);
    } catch {
      contactAlerts = [];
    }
    return NextResponse.json({ ok: true, result, contactAlerts });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
