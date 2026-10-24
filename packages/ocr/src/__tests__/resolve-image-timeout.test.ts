import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOCUMENT_FETCH_TIMEOUT_MS, documentFetchTimeoutMs, resolveImage } from '../providers/_anthropic';

/** Scan download (private bucket → base64) must not hang the OCR job forever. */
let server: Server;
let base = '';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else if (req.url === '/stall-body.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write(PNG.subarray(0, 4)); // headers + first bytes, then nothing
    }
    // any other path: accept and never answer
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('resolveImage fetch timeout', () => {
  it('fetches the bytes when the host answers', async () => {
    const p = await resolveImage(`${base}/ok.png`, true, 2_000);
    expect(p).toEqual({ url: null, data: PNG.toString('base64'), mediaType: 'image/png' });
  });

  it('gives up on a host that never answers', async () => {
    const t0 = Date.now();
    await expect(resolveImage(`${base}/silent.png`, true, 300)).rejects.toThrow(/timed out after 300ms/);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('gives up on a body that stalls after the headers', async () => {
    await expect(resolveImage(`${base}/stall-body.png`, true, 300)).rejects.toThrow(/timed out after 300ms/);
  });

  it('defaults to 20 s, overridable by OCR_FETCH_TIMEOUT_MS', () => {
    expect(documentFetchTimeoutMs({})).toBe(DOCUMENT_FETCH_TIMEOUT_MS);
    expect(DOCUMENT_FETCH_TIMEOUT_MS).toBe(20_000);
    expect(documentFetchTimeoutMs({ OCR_FETCH_TIMEOUT_MS: '5000' })).toBe(5_000);
    expect(documentFetchTimeoutMs({ OCR_FETCH_TIMEOUT_MS: 'nope' })).toBe(DOCUMENT_FETCH_TIMEOUT_MS);
  });
});
