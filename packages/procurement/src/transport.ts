/**
 * The one call the API adapters make. HttpClient implements it for real
 * accounts; FixtureTransport serves recorded platform responses so the same
 * adapter + normalizer run offline (demo tenant, tests) with no credentials.
 */
export type Query = Record<string, string | number | undefined>;

export interface JsonTransport {
  get<T>(path: string, init?: { headers?: Record<string, string>; query?: Query }): Promise<T>;
}

export type FixtureHandler = (query: Query, params: Record<string, string>) => unknown;
export type FixtureRoute = FixtureHandler | Record<string, unknown> | unknown[];

/**
 * Routes are path patterns (`/orders/:id`) → a response body, or a function of
 * the query + path params. An unknown path rejects like a 404 would.
 */
export class FixtureTransport implements JsonTransport {
  constructor(private readonly routes: Record<string, FixtureRoute>) {}

  async get<T>(path: string, init: { query?: Query } = {}): Promise<T> {
    for (const [pattern, route] of Object.entries(this.routes)) {
      const params = matchPath(pattern, path);
      if (!params) continue;
      const body = typeof route === 'function' ? route(init.query ?? {}, params) : route;
      if (body === undefined) break;
      // Hand out a copy so a caller can't mutate the fixture.
      return structuredClone(body) as T;
    }
    throw new Error(`fixture: no response for GET ${path}`);
  }
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const a = path.split('?')[0]!.split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(a[i]!);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

/** Credentials that ask an adapter for its offline fixture instead of the network. */
export function isFixtureMode(credentials: { mode?: unknown }): boolean {
  return credentials.mode === 'fixture';
}
