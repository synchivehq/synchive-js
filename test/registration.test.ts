import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authCalls,
  createV2Client as createClient,
  memoryStorage,
  tokens,
  v2Key,
} from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

const problem = (status: number, code: string, detail: string) =>
  Response.json({ title: "Error", status, detail, code }, { status });

const pending = (registrationSessionExpiresIn = 3600) =>
  Response.json({
    registrationSessionToken: "registration-1",
    registrationSessionExpiresIn,
  });

const signUp = {
  email: "a@b.c",
  password: "pw",
  verificationPageUrl: "https://app.test/verify",
};

describe("sign-up", () => {
  it("signs up with the app's verification page and stays signed out", async () => {
    const { client, calls, events } = createClient({
      "/sign-up/password": () => pending(),
    });

    await client.signUpWithPassword(signUp);

    const [request] = authCalls(calls, "/sign-up/password");
    expect(request?.body).toEqual({
      email: "a@b.c",
      password: "pw",
      options: { emailRedirectTo: "https://app.test/verify" },
    });
    expect(request?.headers.get("x-PublishableKey")).toBe(v2Key());
    expect(await client.getUser()).toBeNull();
    expect(events.map((event) => event.isAuthenticated)).toEqual([false]);
  });

  it("confirms with the stored registration token and signs in", async () => {
    const storage = memoryStorage();
    const { client, calls, events } = createClient(
      {
        "/sign-up/password": () => pending(),
        "/confirm": () => Response.json(tokens({ sub: "user-1" })),
      },
      storage,
    );

    await client.signUpWithPassword(signUp);
    await client.completeRegistration({ token: "verify-1" });

    const [confirm] = authCalls(calls, "/confirm");
    expect(confirm?.body).toEqual({
      token: "verify-1",
      registrationSessionToken: "registration-1",
    });
    // The spec declares no security on registration completion.
    expect(confirm?.headers.has("x-PublishableKey")).toBe(false);
    expect(confirm?.headers.has("Authorization")).toBe(false);
    expect(events.at(-1)?.user?.id).toBe("user-1");
    expect(storage.getItem(`synchive.registration:${v2Key()}`)).toBeNull();
  });

  it("falls back to the password when this browser didn't sign up", async () => {
    const { client, calls } = createClient({
      "/confirm": (call) =>
        (call.body as { password?: string }).password
          ? Response.json(tokens({ sub: "user-1" }))
          : problem(
              401,
              "registration_password_required",
              "Confirm the password used to register this account.",
            ),
    });

    await expect(
      client.completeRegistration({ token: "verify-1" }),
    ).rejects.toMatchObject({
      status: 401,
      code: "registration_password_required",
    });
    await client.completeRegistration({ token: "verify-1", password: "pw" });

    const [first, second] = authCalls(calls, "/confirm");
    expect(first?.body).toEqual({ token: "verify-1" });
    expect(second?.body).toEqual({ token: "verify-1", password: "pw" });
    expect((await client.getUser())?.id).toBe("user-1");
  });

  it("doesn't send an expired registration token", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const { client, calls } = createClient(
      {
        "/sign-up/password": () => pending(60),
        "/confirm": () => Response.json(tokens()),
      },
      storage,
    );

    await client.signUpWithPassword(signUp);
    vi.advanceTimersByTime(60_000);
    await client.completeRegistration({ token: "verify-1", password: "pw" });

    const [confirm] = authCalls(calls, "/confirm");
    expect(confirm?.body).toEqual({ token: "verify-1", password: "pw" });
    expect(storage.getItem(`synchive.registration:${v2Key()}`)).toBeNull();
  });

  it("keeps the registration token when a link fails, so a resent link still works", async () => {
    const { client, calls } = createClient({
      "/sign-up/password": () => pending(),
      "/confirm": (call) =>
        (call.body as { token: string }).token === "old"
          ? problem(
              410,
              "superseded_verification_link",
              "A newer verification link exists.",
            )
          : Response.json(tokens()),
    });

    await client.signUpWithPassword(signUp);
    await expect(
      client.completeRegistration({ token: "old" }),
    ).rejects.toMatchObject({ code: "superseded_verification_link" });
    await client.completeRegistration({ token: "new" });

    const [, retry] = authCalls(calls, "/confirm");
    expect(retry?.body).toEqual({
      token: "new",
      registrationSessionToken: "registration-1",
    });
  });

  it("resends the verification email to the app's verification page", async () => {
    const { client, calls } = createClient({
      "/verification/resend": () => new Response(null, { status: 204 }),
    });

    await client.resendVerification({
      email: "a@b.c",
      verificationPageUrl: "https://app.test/verify",
    });

    const [resend] = authCalls(calls, "/verification/resend");
    expect(resend?.body).toEqual({
      email: "a@b.c",
      options: { emailRedirectTo: "https://app.test/verify" },
    });
    expect(resend?.headers.get("x-PublishableKey")).toBe(v2Key());
  });
});
