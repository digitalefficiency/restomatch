// Test-only preload: captures Resend HTTP sends into a local JSONL file so the
// outbox → email path can be verified end-to-end without a real provider.
//   NODE_OPTIONS="--import ./scripts/local-email-sink.mjs" EMAIL_SINK_FILE=/tmp/sink.jsonl RESEND_API_KEY=re_local …
// Never load this in production: it swallows every api.resend.com call.
import { appendFileSync } from 'node:fs';

const SINK = process.env.EMAIL_SINK_FILE;
if (!SINK) throw new Error('[email-sink] EMAIL_SINK_FILE is required');
if (process.env.NODE_ENV === 'production') throw new Error('[email-sink] refusing to load in production');

const realFetch = globalThis.fetch;
let n = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.resend.com/emails')) {
    const id = `local-${Date.now()}-${++n}`;
    appendFileSync(SINK, JSON.stringify({ id, at: new Date().toISOString(), ...JSON.parse(String(init?.body ?? '{}')) }) + '\n');
    return new Response(JSON.stringify({ id }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};
console.log(`[email-sink] Resend sends are captured in ${SINK}`);
