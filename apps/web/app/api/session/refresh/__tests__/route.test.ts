import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.fn();
const unstable_update = vi.fn();
vi.mock('@/auth', () => ({ auth: () => auth(), unstable_update: (d: unknown) => unstable_update(d) }));

const { GET } = await import('../route');
const req = (qs: string) => new NextRequest(`http://localhost:3000/api/session/refresh${qs}`);

describe('GET /api/session/refresh (post-invite role refresh)', () => {
  afterEach(() => vi.clearAllMocks());

  it('re-issues the session for a signed-in user and continues to `next`', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(req('?next=%2Fdashboard%2Freceiving'));
    expect(unstable_update).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard/receiving');
  });

  it('never redirects off-origin (open-redirect guard)', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const res = await GET(req(`?next=${encodeURIComponent(evil)}`));
      expect(new URL(res.headers.get('location')!).origin).toBe('http://localhost:3000');
    }
  });

  it('does not touch the session when signed out', async () => {
    auth.mockResolvedValue(null);
    const res = await GET(req('?next=%2Fdashboard'));
    expect(unstable_update).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });
});
