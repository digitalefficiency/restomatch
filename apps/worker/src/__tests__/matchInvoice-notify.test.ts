import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatIlsAgorot } from '@restomatch/api';
import { approvalSummary, approvalsGoLink, claimFigure } from '../jobs/matchInvoice';

/**
 * W2-04 §5.7 + §5.12 (approvals-12, ia-nav-09): every approval notification
 * deep-links to the right branch and invoice, and its ₪ comes from the server
 * money util — no baked `₪${…}`, no "הפסד פוטנציאלי", no "חריגות".
 * (The ₪ = Σ claimableLines parity runs on the demo seed in endOfDay-awaiting.)
 */
const here = dirname(fileURLToPath(import.meta.url));

describe('match-invoice notification copy', () => {
  it('the push / WhatsApp body names gaps, the claimable ₪ and the go-link with r + invoice', () => {
    const link = approvalsGoLink('rid-1', 'inv-1', 'https://app.test');
    expect(new URL(link).searchParams.get('r')).toBe('rid-1');
    expect(new URL(link).searchParams.get('to')).toBe('/dashboard/approvals?invoice=inv-1');
    const body = approvalSummary(3, claimFigure(10_480, 0), link);
    expect(body).toContain('3 פערים');
    expect(body).toContain(formatIlsAgorot(10_480, { maximumFractionDigits: 2 }));
    expect(body).toContain(link);
    expect(approvalSummary(1, null, link)).not.toMatch(/₪/);
    expect(approvalSummary(1, null, link, { pendingLink: true })).toContain('ממתינה לקישור להזמנה');
  });

  it('a duplicate invoice is never "no amount": its incl.-VAT claim is named on its own (warden MEDIUM-1)', () => {
    const incl = formatIlsAgorot(117_000, { maximumFractionDigits: 2 });
    expect(claimFigure(0, 117_000)).toBe(`${incl} כולל מע״מ (חשבונית כפולה)`);
    expect(claimFigure(10_480, 117_000)).toBe(`${formatIlsAgorot(10_480, { maximumFractionDigits: 2 })} + ${incl} כולל מע״מ (חשבונית כפולה)`);
    expect(claimFigure(0, 0)).toBeNull();
    const body = approvalSummary(1, claimFigure(0, 117_000), 'https://app.test/x');
    expect(body).toContain(incl);
    expect(body).toContain('לבקשת זיכוי');
  });

  it('no "הפסד פוטנציאלי", no "חריגות", no "דליפה" and no baked ₪${…} in the approval producers', () => {
    for (const f of ['matchInvoice.ts', 'endOfDayReport.ts']) {
      const src = readFileSync(join(here, '..', 'jobs', f), 'utf8');
      expect(src).not.toMatch(/הפסד פוטנציאלי|חריגות|דליפה/);
      expect(src).not.toMatch(/₪\$\{/);
    }
  });

  it('ONE alert path per matched invoice: persist (shared with match.runForInvoice) sends nothing, matchInvoice notifies once', () => {
    const api = join(here, '..', '..', '..', '..', 'packages', 'api', 'src');
    for (const f of [join(api, 'match', 'persist.ts'), join(api, 'routers', 'match.ts')]) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/enqueueNotification\(|\.send\(|createPushNotifier|createWhatsAppNotifier|createEmailNotifier/);
    }
    const job = readFileSync(join(here, '..', 'jobs', 'matchInvoice.ts'), 'utf8');
    // matchAlert stays a pure copy helper; this job does not also send its body.
    expect(job).not.toMatch(/matchAlert\(/);
    expect(job.match(/push\.send\(/g)).toHaveLength(1);
    expect(job.match(/whatsapp\.send\(/g)).toHaveLength(1);
    expect(job.match(/approvalNeededEmail\(/g)).toHaveLength(1);
  });
});
