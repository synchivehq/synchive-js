import { vi } from "vitest";
import { SyncHiveClient, type AuthState } from "../src";

export const base64Url = (value: string): string =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const v1Key = (
  payload = "prod::HIVE1::secret",
  region = "us-west-2",
): string => `sh_publishable_v1_${region}_${base64Url(payload)}`;

export const v2Key = (
  payload = "prod::HIVE1::secret",
  region = "us-west-2",
): string => `sh_publishable_v2_${region}_${base64Url(payload)}`;

export const legacyKey = (payload = "secret::prod"): string =>
  `sh_publishable_${base64Url(payload)}`;

export const jwt = (claims: Record<string, unknown>): string =>
  `header.${base64Url(JSON.stringify(claims))}.signature`;

export const tokens = (
  claims: Record<string, unknown> = { sub: "user-1" },
  expiresIn = 3600,
  refreshToken = `refresh-${String(claims.sub)}`,
) => ({ accessToken: jwt(claims), refreshToken, expiresIn });

export const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
};

export type Call = {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
};

/** A fake fetch: `routes` maps a URL suffix to a handler returning the response. */
export const fakeFetch = (
  routes: Record<string, (call: Call) => Response | Promise<Response>>,
) => {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const route = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (!route) return Response.json({ ok: true });
    return routes[route]!(call);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
};

/** Stubs the parts of `window` the SDK reads, at the given URL. */
export const stubWindow = (href = "https://app.test/") => {
  const url = new URL(href);
  const window = {
    location: { href, pathname: url.pathname, origin: url.origin },
    history: {
      state: null,
      replaceState: vi.fn((_state: unknown, _title: string, next: string) => {
        window.location.href = next;
      }),
    },
  };
  vi.stubGlobal("window", window);
  return window;
};

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

export const AUTH = "https://us-west-2-apis.synchive.com/v1/hives/HIVE1/auth";
export const API = "https://us-west-2-apis.synchive.com/v2/hives/HIVE1";

export const authCalls = (calls: Call[], path: string) =>
  calls.filter((call) => call.url === `${AUTH}${path}`);

/** A V2 client against a fake server, recording calls and auth state events. */
export const createV2Client = (
  routes: Record<string, (call: Call) => Response | Promise<Response>>,
  storage = memoryStorage(),
) => {
  const { fetch, calls } = fakeFetch(routes);
  const client = new SyncHiveClient({
    publishableKey: v2Key(),
    storage,
    fetch,
  });
  const events: AuthState[] = [];
  client.onAuthStateChange((state) => events.push(state));
  return { client, calls, events, storage, fetch };
};
