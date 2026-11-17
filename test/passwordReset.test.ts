import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authCalls,
  createV2Client as createClient,
  stubWindow,
  tokens,
  v2Key,
} from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const problem = (status: number, code: string, detail: string) =>
  Response.json({ title: "Error", status, detail, code }, { status });

describe("password change", () => {
  it("changes the password with the session and publishable key", async () => {
    const signedIn = tokens();
    const { client, calls, events } = createClient({
      "/sign-in/password": () => Response.json(signedIn),
      "/password/change": () => new Response(null, { status: 204 }),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "old" });
    await client.changePassword({ currentPassword: "old", newPassword: "new" });

    const [change] = authCalls(calls, "/password/change");
    expect(change?.body).toEqual({
      currentPassword: "old",
      newPassword: "new",
    });
    expect(change?.headers.get("Authorization")).toBe(
      `Bearer ${signedIn.accessToken}`,
    );
    expect(change?.headers.get("x-PublishableKey")).toBe(v2Key());
    expect(events.at(-1)?.isAuthenticated).toBe(true);
  });

  it("requires a signed-in user", async () => {
    const { client, calls } = createClient({});

    await expect(
      client.changePassword({ currentPassword: "old", newPassword: "new" }),
    ).rejects.toThrow(
      "User is not authenticated. Call signInWithPassword() first.",
    );
    expect(authCalls(calls, "/password/change")).toHaveLength(0);
  });

  it("exposes the code when the current password is wrong", async () => {
    const { client } = createClient({
      "/sign-in/password": () => Response.json(tokens()),
      "/password/change": () =>
        problem(
          400,
          "incorrect_password",
          "The password provided was incorrect.",
        ),
    });

    await client.signInWithPassword({ email: "a@b.c", password: "old" });

    await expect(
      client.changePassword({ currentPassword: "nope", newPassword: "new" }),
    ).rejects.toMatchObject({
      message: "The password provided was incorrect.",
      status: 400,
      code: "incorrect_password",
    });
  });
});

describe("password reset", () => {
  it("requests a reset email for the app's reset page", async () => {
    const { client, calls } = createClient({
      "/password/reset/request": () => new Response(null, { status: 204 }),
    });

    await client.requestPasswordReset({
      email: "a@b.c",
      passwordResetPageUrl: "https://app.test/reset",
    });

    const [request] = authCalls(calls, "/password/reset/request");
    expect(request?.body).toEqual({
      email: "a@b.c",
      options: { passwordResetPageUrl: "https://app.test/reset" },
    });
    expect(request?.headers.get("x-PublishableKey")).toBe(v2Key());
    expect(request?.headers.has("Authorization")).toBe(false);
  });

  it("completes the reset with the token", async () => {
    const window = stubWindow(
      "https://app.test/reset?sh_password_reset_token=tok",
    );
    const { client, calls } = createClient({
      "/password/reset": () => new Response(null, { status: 204 }),
    });

    await client.completePasswordReset({ token: "tok", newPassword: "new" });

    const [reset] = authCalls(calls, "/password/reset");
    expect(reset?.body).toEqual({ token: "tok", newPassword: "new" });
    // The spec declares no security on reset completion.
    expect(reset?.headers.has("x-PublishableKey")).toBe(false);
    expect(reset?.headers.has("Authorization")).toBe(false);
    // The app owns its URL.
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it("exposes the code when the link is no longer valid", async () => {
    const { client } = createClient({
      "/password/reset": () =>
        problem(
          410,
          "used_password_reset_link",
          "This password reset link has already been used.",
        ),
    });

    await expect(
      client.completePasswordReset({ token: "tok", newPassword: "new" }),
    ).rejects.toMatchObject({
      message: "This password reset link has already been used.",
      status: 410,
      code: "used_password_reset_link",
    });
  });
});
