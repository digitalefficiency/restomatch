/**
 * Minimal HTTP client with retry/backoff. No external HTTP library —
 * uses fetch directly. Retry strategy: exponential backoff on 5xx
 * (server errors) and 429 (rate limit) responses.
 *
 * For Node 20+ which has fetch built-in.
 */

export interface HttpClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  /** Base delay in milliseconds between retries (doubled each attempt). */
  retryBaseDelayMs?: number;
  /** Timeout per attempt in milliseconds. */
  timeoutMs?: number;
  /** Override fetch (mainly for testing — e.g., msw or jest mocks). */
  fetchImpl?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.defaultHeaders = opts.defaultHeaders ?? {};
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 200;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async get<T>(path: string, init: { headers?: Record<string, string>; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    return this.request<T>('GET', path, init);
  }

  async post<T>(
    path: string,
    init: { headers?: Record<string, string>; query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    return this.request<T>('POST', path, init);
  }

  private async request<T>(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T> {
    const url = this.buildUrl(path, init.query);
    const headers = { ...this.defaultHeaders, ...init.headers };
    if (init.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await this.fetchImpl(url, {
            method,
            headers,
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            signal: controller.signal,
          });
          if (res.ok) {
            // 204 / empty body
            if (res.status === 204) return undefined as T;
            const text = await res.text();
            return text ? (JSON.parse(text) as T) : (undefined as T);
          }
          const isRetryable = res.status >= 500 || res.status === 429;
          const body = await res.text();
          const err = new HttpError(res.status, url, body);
          if (!isRetryable || attempt === this.maxRetries) throw err;
          lastErr = err;
        } finally {
          clearTimeout(t);
        }
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status < 500 && e.status !== 429) throw e;
          lastErr = e;
        } else {
          lastErr = e;
        }
        if (attempt === this.maxRetries) throw lastErr;
      }
      await sleep(this.retryBaseDelayMs * 2 ** attempt);
    }
    throw lastErr ?? new Error('request failed');
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const base = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
