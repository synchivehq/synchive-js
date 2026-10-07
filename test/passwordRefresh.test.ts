import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncHiveClient } from "../src";
import {
  API,
  authCalls,
  createV2Client,
  deferred,
  fakeFetch,
  memoryStorage,
  stubWindow,
  tokens,
  v2Key,
  type Call,
} from "./helpers";

/** Tokens numbered by issue order: access token claim `n` and refresh token `refresh-n`. */
const issued = (n: number, expiresIn: number) =>
  tokens({ sub: "user-1", n }, expiresIn, `refresh-${n}`);

/** A refresh endpoint that rotates tokens, issuing refresh-1, refresh-2, ... */
const rotatingRefresh = (expiresIn = 60) => {
  let n = 0;
  return () => Response.json(issued(++n, expiresIn));
};

const signIn = async (client: SyncHiveClient) =>
  client.signInWithPassword({ email: "a@b.c", password: "pw" });

const refreshBodies = (calls: Call[]) =>
  authCalls(calls, "/refresh").map((call) => call.body);

const apiAuthorization = (calls: Call[]) =>
  calls
    .filter((call) => call.url.startsWith(API))
    .map((call) => call.headers.get("Authorization"));

const advanceClock = (seconds: number) =>
  vi.setSystemTime(Date.now() + seconds * 1000);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("V2 token refresh", () => {
  it("rotates the refresh token across consecutive refreshes", async () => {
    const { client, calls } = createV2Client({
      "/sign-in/password": () => Response.json(issued(0, 60)),
      "/refresh": rotatingRefresh(60),
    });

    await signIn(client);
    advanceClock(40);
    await client.get("Product", "P1");
    advanceClock(40);
    await client.get("Product", "P2");

    expect(refreshBodies(calls)).toEqual([
      { refreshToken: "refresh-0" },
      { refreshToken: "refresh-1" },
    ]);
    expect(apiAuthorization(calls)).toEqual([
      `Bearer ${issued(1, 60).accessToken}`,
      `Bearer ${issued(2, 60).accessToken}`,
    ]);
    // Outside a browser, refresh happens on demand only.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the session when a refresh fails without a 401, and retries", async () => {
    const responses = [
      () => new Response("unavailable", { status: 500 }),
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Response.json(issued(1, 3600)),
    ];
    const { client, calls, events } = createV2Client({
      "/sign-in/password": () => Response.json(issued(0, 10)),
      "/refresh": () => responses.shift()!(),
    });

    await signIn(client);
    await expect(client.get("Product", "P1")).rejects.toThrow(
      "Authentication failed (500).",
    );
    await expect(client.get("Product", "P1")).rejects.toThrow(
      "Failed to fetch",
    );
    expect(await client.getUser()).not.toBeNull();
    expect(events.at(-1)?.isAuthenticated).toBe(true);

    await client.get("Product", "P1");

    expect(refreshBodies(calls)).toEqual([
      { refreshToken: "refresh-0" },
      { refreshToken: "refresh-0" },
      { refreshToken: "refresh-0" },
    ]);
    expect(apiAuthorization(calls)).toEqual([
      `Bearer ${issued(1, 3600).accessToken}`,
    ]);
  });

  it("makes one refresh request when two tabs refresh at once", async () => {
    const storage = memoryStorage();
    const refresh = deferred<Response>();
    const { fetch, calls } = fakeFetch({
      "/sign-in/password": () => Response.json(issued(0, 10)),
      "/refresh": () => refresh.promise,
    });
    const tabA = new SyncHiveClient({
      publishableKey: v2Key(),
      storage,
      fetch,
    });
    const tabB = new SyncHiveClient({
      publishableKey: v2Key(),
      storage,
      fetch,
    });

    await signIn(tabA);
    const requests = [tabA.get("Product", "P1"), tabB.get("Product", "P2")];
    await vi.waitFor(() =>
      expect(authCalls(calls, "/refresh")).toHaveLength(1),
    );
    refresh.resolve(Response.json(issued(1, 3600)));
    await Promise.all(requests);

    expect(refreshBodies(calls)).toEqual([{ refreshToken: "refresh-0" }]);
    expect(apiAuthorization(calls)).toEqual([
      `Bearer ${issued(1, 3600).accessToken}`,
      `Bearer ${issued(1, 3600).accessToken}`,
    ]);
  });

  it("keeps a sign-in that happens while a rejected refresh is in flight", async () => {
    const refresh = deferred<Response>();
    const { client, calls } = createV2Client({
      "/sign-in/password": (call) =>
        Response.json(
          (call.body as { email: string }).email === "old"
            ? issued(0, 10)
            : tokens({ sub: "new" }),
        ),
      "/refresh": () => refresh.promise,
    });

    await client.signInWithPassword({ email: "old", password: "pw" });
    const request = client.get("Product", "P1");
    await vi.waitFor(() =>
      expect(authCalls(calls, "/refresh")).toHaveLength(1),
    );

    await client.signInWithPassword({ email: "new", password: "pw" });
    refresh.resolve(new Response(null, { status: 401 }));
    await request;

    expect((await client.getUser())?.id).toBe("new");
  });

  it("signs out with a refreshed token when the access token has expired", async () => {
    const { client, calls } = createV2Client({
      "/sign-in/password": () => Response.json(issued(0, 10)),
      "/refresh": rotatingRefresh(3600),
      "/logout": () => new Response(null, { status: 204 }),
    });

    await signIn(client);
    advanceClock(60);
    await client.signOut();

    expect(calls.map((call) => call.url.split("/auth")[1])).toEqual([
      "/sign-in/password",
      "/refresh",
      "/logout",
    ]);
    expect(authCalls(calls, "/logout")[0]?.headers.get("Authorization")).toBe(
      `Bearer ${issued(1, 3600).accessToken}`,
    );
    expect(await client.getUser()).toBeNull();
  });

  describe("init()", () => {
    it("refreshes an expired stored session", async () => {
      const storage = memoryStorage();
      const { client: previousPage } = createV2Client(
        { "/sign-in/password": () => Response.json(issued(0, 10)) },
        storage,
      );
      await signIn(previousPage);
      advanceClock(60);

      const { client, calls, events } = createV2Client(
        { "/refresh": rotatingRefresh(3600) },
        storage,
      );
      await client.init();

      expect(refreshBodies(calls)).toEqual([{ refreshToken: "refresh-0" }]);
      expect((await client.getUser())?.expired).toBe(false);
      expect(events.at(-1)?.isAuthenticated).toBe(true);
    });

    it("keeps the stored session when the refresh fails, and retries on the next request", async () => {
      const storage = memoryStorage();
      const { client: previousPage } = createV2Client(
        { "/sign-in/password": () => Response.json(issued(0, 10)) },
        storage,
      );
      await signIn(previousPage);
      advanceClock(60);

      const responses = [
        () => new Response(null, { status: 503 }),
        () => Response.json(issued(1, 3600)),
      ];
      const { client, calls } = createV2Client(
        { "/refresh": () => responses.shift()!() },
        storage,
      );

      await expect(client.init()).resolves.toBeUndefined();
      expect(await client.getUser()).not.toBeNull();

      await client.get("Product", "P1");
      expect(refreshBodies(calls)).toHaveLength(2);
      expect(apiAuthorization(calls)).toEqual([
        `Bearer ${issued(1, 3600).accessToken}`,
      ]);
    });
  });

  describe("background refresh", () => {
    beforeEach(() => {
      stubWindow();
    });

    it("keeps refreshing as each new token nears expiry", async () => {
      const { client, calls } = createV2Client({
        "/sign-in/password": () => Response.json(issued(0, 90)),
        "/refresh": rotatingRefresh(90),
      });

      await signIn(client);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refreshBodies(calls)).toEqual([
        { refreshToken: "refresh-0" },
        { refreshToken: "refresh-1" },
      ]);
      expect(vi.getTimerCount()).toBe(1);
      await client.signOut();
    });

    it("refreshes straight away when the token is already inside the margin", async () => {
      const { client, calls } = createV2Client({
        "/sign-in/password": () => Response.json(issued(0, 20)),
        "/refresh": rotatingRefresh(3600),
      });

      await signIn(client);
      await vi.advanceTimersByTimeAsync(0);

      expect(refreshBodies(calls)).toEqual([{ refreshToken: "refresh-0" }]);
      await client.signOut();
    });

    it("stops after a failed refresh and leaves the retry to the next request", async () => {
      const { client, calls } = createV2Client({
        "/sign-in/password": () => Response.json(issued(0, 90)),
        "/refresh": () => new Response(null, { status: 500 }),
      });

      await signIn(client);
      // An unhandled rejection from the timer would fail this test run.
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refreshBodies(calls)).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(await client.getUser()).not.toBeNull();
    });

    it("is scheduled by init() for a stored session that's still fresh", async () => {
      const storage = memoryStorage();
      vi.unstubAllGlobals(); // No timer for the previous page.
      const { client: previousPage } = createV2Client(
        { "/sign-in/password": () => Response.json(issued(0, 3600)) },
        storage,
      );
      await signIn(previousPage);

      stubWindow();
      const { client, calls } = createV2Client(
        { "/refresh": rotatingRefresh(3600) },
        storage,
      );
      await client.init();
      expect(refreshBodies(calls)).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(3570_000);
      expect(refreshBodies(calls)).toEqual([{ refreshToken: "refresh-0" }]);
      await client.signOut();
    });
  });
});
