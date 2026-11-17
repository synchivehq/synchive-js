import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncHiveAuthError } from "../src";
import {
  API,
  authCalls,
  createV2Client as createClient,
  deferred,
  memoryStorage,
  stubWindow,
  tokens,
  v2Key,
} from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("V2 password auth", () => {
  it("signs in, notifies listeners and authorizes API requests", async () => {
    const signedIn = tokens({ sub: "user-1", email: "ada@example.com" });
    const { client, calls, events } = createClient({
      "/sign-in/password": () => Response.json(signedIn),
    });

    await client.signInWithPassword({
      email: "ada@example.com",
      password: "pw",
    });
    await client.get("Product", "P1");

    const [signIn] = authCalls(calls, "/sign-in/password");
    expect(signIn?.body).toEqual({ email: "ada@example.com", password: "pw" });
    expect(signIn?.headers.get("x-PublishableKey")).toBe(v2Key());

    expect(events.map((event) => event.isAuthenticated)).toEqual([false, true]);
    expect(events[1]?.user?.email).toBe("ada@example.com");

    const request = calls.find(
      (call) => call.url === `${API}/shape/Product/P1`,
    );
    expect(request?.headers.get("Authorization")).toBe(
      `Bearer ${signedIn.accessToken}`,
    );
    expect(request?.headers.get("x-PublishableKey")).toBe(v2Key());
  });

  it("exposes status and code on failed sign-in", async () => {
    const { client } = createClient({
      "/sign-in/password": () =>
        Response.json(
          {
            type: "about:blank",
            title: "Forbidden",
            status: 403,
            detail: "The account email must be verified before signing in.",
            code: "account_email_not_verified",
          },
          { status: 403 },
        ),
    });

    const error = (await client
      .signInWithPassword({ email: "a@b.c", password: "pw" })
      .catch((caught: unknown) => caught)) as SyncHiveAuthError;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      "The account email must be verified before signing in.",
    );
    expect(error.status).toBe(403);
    expect(error.code).toBe("account_email_not_verified");
  });

  it("falls back to a generic message when the error has no body", async () => {
    const { client } = createClient({
      "/sign-up/password": () => new Response(null, { status: 503 }),
    });

    await expect(
      client.signUpWithPassword({
        email: "a@b.c",
        password: "pw",
        verificationPageUrl: "https://app.test/verify",
      }),
    ).rejects.toMatchObject({
      message: "Authentication failed (503).",
      status: 503,
      code: undefined,
    });
  });

  it("does not expose the refresh token on the user", async () => {
    const { client } = createClient({
      "/sign-in/password": () => Response.json(tokens()),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "pw" });
    const user = await client.getCurrentUser();

    expect(user).not.toHaveProperty("refreshToken");
    expect(user?.expired).toBe(false);
    expect(JSON.stringify(user)).not.toContain("refresh-user-1");
  });

  it("maps access token claims onto the user", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const signedIn = tokens(
      { sub: "user-1", email: "ada@example.com", name: "Ada", role: "admin" },
      3600,
    );
    const { client } = createClient({
      "/sign-in/password": () => Response.json(signedIn),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "pw" });

    expect({ ...(await client.getCurrentUser()) }).toEqual({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      claims: {
        sub: "user-1",
        email: "ada@example.com",
        name: "Ada",
        role: "admin",
      },
      accessToken: signedIn.accessToken,
      expiresAt: Date.parse("2026-01-01T01:00:00Z"),
      expired: false,
    });

    vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    expect((await client.getCurrentUser())?.expired).toBe(true);
  });

  it("shares one refresh between concurrent requests", async () => {
    const { client, calls } = createClient({
      "/sign-in/password": () => Response.json(tokens({ sub: "user-1" }, 10)),
      "/refresh": () =>
        Response.json(tokens({ sub: "user-1" }, 3600, "rotated")),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "pw" });
    await Promise.all([
      client.get("Product", "P1"),
      client.get("Product", "P2"),
    ]);

    const refreshes = authCalls(calls, "/refresh");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.body).toEqual({ refreshToken: "refresh-user-1" });
  });

  it("signs out when the refresh token is rejected", async () => {
    const { client, events } = createClient({
      "/sign-in/password": () => Response.json(tokens({ sub: "user-1" }, 10)),
      "/refresh": () => new Response(null, { status: 401 }),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "pw" });

    await expect(client.get("Product", "P1")).rejects.toThrow(
      "User is not authenticated. Call signInWithPassword() first.",
    );
    expect(await client.getCurrentUser()).toBeNull();
    expect(events.at(-1)?.isAuthenticated).toBe(false);
  });

  it("keeps a sign-in that happens while a refresh is in flight", async () => {
    const refresh = deferred<Response>();
    const { client, calls } = createClient({
      "/sign-in/password": (call) => {
        const { email } = call.body as { email: string };
        return Response.json(
          tokens({ sub: email }, email === "old" ? 10 : 3600),
        );
      },
      "/refresh": () => refresh.promise,
    });

    await client.signInWithPassword({ email: "old", password: "pw" });
    const request = client.get("Product", "P1");
    await vi.waitFor(() =>
      expect(authCalls(calls, "/refresh")).toHaveLength(1),
    );

    await client.signInWithPassword({ email: "new", password: "pw" });
    refresh.resolve(Response.json(tokens({ sub: "old" }, 3600, "rotated-old")));
    await request;

    expect((await client.getCurrentUser())?.id).toBe("new");
    const apiCall = calls.find(
      (call) => call.url === `${API}/shape/Product/P1`,
    );
    expect(apiCall?.headers.get("Authorization")).toBe(
      `Bearer ${tokens({ sub: "new" }).accessToken}`,
    );
  });

  it("treats corrupt stored sessions as signed out", async () => {
    const storage = memoryStorage();
    storage.setItem(`synchive.session:${v2Key()}`, "{not json");
    const { client, events } = createClient({}, storage);

    await expect(client.init()).resolves.toBeUndefined();
    expect(await client.getCurrentUser()).toBeNull();
    expect(events).toEqual([{ user: null, isAuthenticated: false }]);
  });

  it("revokes the session on sign-out and clears it even if logout fails", async () => {
    const signedIn = tokens();
    const { client, calls, events } = createClient({
      "/sign-in/password": () => Response.json(signedIn),
      "/logout": () => new Response("boom", { status: 500 }),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "pw" });
    await expect(client.signOut()).rejects.toThrow(
      "Authentication failed (500).",
    );

    const [logout] = authCalls(calls, "/logout");
    expect(logout?.headers.get("Authorization")).toBe(
      `Bearer ${signedIn.accessToken}`,
    );
    expect(await client.getCurrentUser()).toBeNull();
    expect(events.at(-1)?.isAuthenticated).toBe(false);
  });

  it("refreshes in the background shortly before expiry", async () => {
    vi.useFakeTimers();
    stubWindow();
    const { client, calls } = createClient({
      "/sign-in/password": () => Response.json(tokens({ sub: "user-1" }, 90)),
      "/refresh": () =>
        Response.json(tokens({ sub: "user-1" }, 3600, "rotated")),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "pw" });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(authCalls(calls, "/refresh")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(authCalls(calls, "/refresh")).toHaveLength(1);

    await client.signOut();
    expect(vi.getTimerCount()).toBe(0);
  });
});
