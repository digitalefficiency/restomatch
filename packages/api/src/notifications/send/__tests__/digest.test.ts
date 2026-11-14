import { describe, expect, it } from 'vitest';
import { DIGEST_MAX_ITEMS, foldDigest, type DigestCandidate } from '../digest';

function row(i: number, over: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    id: `r${String(i).padStart(2, '0')}`,
    restaurantId: 'rest-1',
    channel: 'email',
    target: 'owner@example.test',
    subject: `התראה ${i}`,
    body: `גוף ${i}\nשורה שנייה`,
    payload: { userId: 'u-1', event: 'invoice.flagged', digest: true },
    // 2026-11-08 06:00 IL = 04:00Z (G-06 moves over-cap rows to the next allowed slot)
    scheduledAt: new Date(Date.UTC(2026, 10, 8, 4, i)),
    ...over,
  };
}

describe('foldDigest (G-06 over-cap rows → one message)', () => {
  it('folds one person/channel/day into one message listing every item, no ₪ sum', () => {
    const [msg, ...rest] = foldDigest([row(1), row(2), row(3)]);
    expect(rest).toHaveLength(0);
    expect(msg!.rowIds).toEqual(['r01', 'r02', 'r03']);
    expect(msg!.dedupeKey).toBe('digest:rest-1:u-1:email:2026-11-08');
    expect(msg!.subject).toBe('סיכום עדכונים · 3');
    expect(msg!.body.split('\n')).toEqual(['3 עדכונים שחיכו לך מאתמול:', '• התראה 1', '• התראה 2', '• התראה 3']);
  });

  it('ignores non-digest rows and splits by person, channel and Israel day (not UTC day)', () => {
    const msgs = foldDigest([
      row(1),
      row(2, { payload: { userId: 'u-1' } }), // not a digest row
      row(3, { payload: { userId: 'u-2', digest: true } }),
      row(4, { channel: 'whatsapp' }),
      // 2026-11-08 23:30Z = 2026-11-09 01:30 IL → next Israel day
      row(5, { scheduledAt: new Date(Date.UTC(2026, 10, 8, 23, 30)) }),
    ]);
    expect(msgs.map((m) => m.dedupeKey).sort()).toEqual([
      'digest:rest-1:u-1:email:2026-11-08',
      'digest:rest-1:u-1:email:2026-11-09',
      'digest:rest-1:u-1:whatsapp:2026-11-08',
      'digest:rest-1:u-2:email:2026-11-08',
    ]);
  });

  it('lists at most DIGEST_MAX_ITEMS and counts the rest', () => {
    const rows = Array.from({ length: DIGEST_MAX_ITEMS + 3 }, (_, i) => row(i + 1));
    const [msg] = foldDigest(rows);
    expect(msg!.rowIds).toHaveLength(DIGEST_MAX_ITEMS + 3);
    expect(msg!.body.split('\n').filter((l) => l.startsWith('• '))).toHaveLength(DIGEST_MAX_ITEMS);
    expect(msg!.body).toContain('ועוד 3 במסך המשימות.');
  });
});
