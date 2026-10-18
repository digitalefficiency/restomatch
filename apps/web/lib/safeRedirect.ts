/**
 * Open-redirect guard for post-login `callbackUrl` (D1.7).
 *
 * `callbackUrl` is attacker-controllable (`/login?callbackUrl=…`) and is fed
 * straight into Auth.js `redirectTo`. Without validation an attacker can craft
 * `https://evil.com` or the protocol-relative `//evil.com` to bounce a freshly
 * authenticated user to a phishing page. We accept ONLY same-origin absolute
 * PATHS — a single leading slash, never `//`, never a backslash variant, never
 * an embedded scheme — and fall back to a safe default otherwise.
 *
 * Pure + dependency-free so it unit-tests without a Next runtime.
 */

const DEFAULT_PATH = '/dashboard';

/**
 * True if `value` contains a space, any control character (code <= 0x20), or DEL
 * (0x7f). Such characters can be normalised into a host boundary by some
 * clients/proxies; valid path characters are all printable (>= 0x21).
 */
function hasForbiddenChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Return `input` iff it is a safe relative path, else `fallback`.
 *
 * Rejected: empty/non-string, anything not starting with `/`, protocol-relative
 * `//host`, backslash tricks (`/\host`, `\\host`), embedded schemes (`https:`,
 * which can never lead with `/`), and control/whitespace characters.
 */
export function safeRelativePath(input: unknown, fallback: string = DEFAULT_PATH): string {
  if (typeof input !== 'string') return fallback;
  const value = input.trim();
  if (value === '') return fallback;

  // Must be an absolute path on THIS origin: exactly one leading slash.
  if (!value.startsWith('/')) return fallback;
  // Protocol-relative ("//evil.com") or scheme-relative backslash ("/\evil.com").
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Any backslash can be re-interpreted as a path/host separator by some clients.
  if (value.includes('\\')) return fallback;
  if (hasForbiddenChar(value)) return fallback;

  return value;
}
