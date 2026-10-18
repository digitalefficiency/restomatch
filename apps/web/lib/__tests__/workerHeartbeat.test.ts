import { describe, expect, it } from 'vitest';
import { evaluateHeartbeat, isWorkerDown } from '../workerHeartbeat';

const NOW = new Date('2026-09-08T10:00:00Z');

describe('evaluateHeartbeat', () => {
  it('reports ok for a recent beat', () => {
    const raw = JSON.stringify({ at: '2026-09-08T09:59:20Z', pid: 1, host: 'mac' });
    const s = evaluateHeartbeat(raw, NOW);
    expect(s.state).toBe('ok');
    expect(isWorkerDown(s)).toBe(false);
  });

  it('reports stale after 10 minutes', () => {
    const raw = JSON.stringify({ at: '2026-09-08T09:49:00Z' });
    const s = evaluateHeartbeat(raw, NOW);
    expect(s.state).toBe('stale');
    expect(isWorkerDown(s)).toBe(true);
    if (s.state === 'stale') expect(s.ageMs).toBe(11 * 60_000);
  });

  it('reports missing when the key is absent (TTL expired or never written)', () => {
    expect(evaluateHeartbeat(null, NOW).state).toBe('missing');
    expect(evaluateHeartbeat('', NOW).state).toBe('missing');
  });

  it('reports invalid on garbage or a bad timestamp', () => {
    expect(evaluateHeartbeat('not json', NOW).state).toBe('invalid');
    expect(evaluateHeartbeat(JSON.stringify({ at: 'yesterday' }), NOW).state).toBe('invalid');
  });
});
