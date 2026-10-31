import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatIlsAgorot } from '@restomatch/api';
import { approvalSummary, approvalsGoLink } from '../jobs/matchInvoice';

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
    const body = approvalSummary(3, 10_480, link);
    expect(body).toContain('3 פערים');
    expect(body).toContain(formatIlsAgorot(10_480, { maximumFractionDigits: 2 }));
    expect(body).toContain(link);
    expect(approvalSummary(1, 0, link)).not.toMatch(/₪/);
  });

  it('no "הפסד פוטנציאלי", no "חריגות", no "דליפה" and no baked ₪${…} in the approval producers', () => {
    for (const f of ['matchInvoice.ts', 'endOfDayReport.ts']) {
      const src = readFileSync(join(here, '..', 'jobs', f), 'utf8');
      expect(src).not.toMatch(/הפסד פוטנציאלי|חריגות|דליפה/);
      expect(src).not.toMatch(/₪\$\{/);
    }
  });
});
