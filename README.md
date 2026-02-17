# SyncHive JS SDK

JavaScript SDK for authenticating and communicating securely with SyncHive.

## Install

```bash
npm install @synchive/synchive-js
```

## Usage

```ts
import { SyncHiveClient } from "@synchive/synchive-js";

const synchive = new SyncHiveClient({
  publishableKey: "sh_publishable_c2hrX2xpdmVf...ODo",
});

// Initialize the client
try {
  await synchive.init();
} catch (error) {
  // Surface sign-in callback errors to the user
  console.error("Auth failed:", error);
}

// Listen for auth lifecycle events.
synchive.onAuthStateChange(({ user }, event) => {
  // Events fire immediately on mount, then again whenever auth state changes.
  if (event === "authenticated") {
    // Set user state and show logged-in UI.
    // setUser(user);
  }

  if (event === "unauthenticated") {
    // Clear user state and show logged-out UI.
    // setUser(null);
  }
});

// Data helpers
try {
  const products = await synchive.list("Product", {
    top: 20,
    skip: 0,
    filter: "name eq 'Two-Slice Toaster'",
    orderby: "createdOn desc,name asc",
  });
  const product = await synchive.get("Product", "D6BFA0AB71A1");
  const created = await synchive.create("Product", {
    name: "Two-Slice Toaster",
    sku: "TOASTER-2S-BLK",
  });
  const updated = await synchive.update("Product", "D6BFA0AB71A1", {
    status: "discontinued",
  });
} catch (error) {
  // Surface data errors to the user
  console.error("Data load failed:", error);
}
```

Most apps only need `init()`, `onAuthStateChange()`, `signInRedirect()`, `list()`, `get()`, `create()`, and `update()`.

## Helpers

Common

- `init(): Promise<void>`
- `onAuthStateChange(listener: AuthStateChangeListener): AuthStateChangeUnsubscribe` (returns a cleanup callback)
- `signInRedirect(): Promise<void>`
- `list<T>(shape: string, params?: { top?: number; skip?: number; filter?: string; orderby?: string }): Promise<{ shapes: T[]; pagination: { totalItems?: number; totalPages?: number; pageNumber?: number; pageSize?: number } }>`
- `get<T>(shape: string, hiveId: string): Promise<T>`
- `create<T>(shape: string, payload: T): Promise<T>`
- `update<T>(shape: string, hiveId: string, payload: Partial<T> | T): Promise<T>`

Advanced

- `signOutRedirect(): Promise<void>`
- `getUser(): Promise<User | null>`

## Notes

- Tokens are stored in `localStorage` using `oidc-client-ts`. Be aware any XSS in your app can expose these tokens.
<<<<<<< HEAD
- `init()` is callback initialization only and throws if sign-in callback handling fails. Wrap it in `try/catch` to show a user-friendly message.
- `onAuthStateChange()` calls your listener immediately with current state, then again whenever auth state changes.
- Auth lifecycle event names are exported as SDK types via `AuthStateChangeTrigger`: `"authenticated"` and `"unauthenticated"`.
- On initial mount, the first emitted event can be either `"authenticated"` or `"unauthenticated"` depending on whether a valid session already exists.
=======
- `init()` runs on sign-in and sign-out callbacks and throws if callback handling fails. Wrap it in `try/catch` to show a user-friendly message.
>>>>>>> a0710f2829211fd688da3a2eda4ceb58da445b8f
- If this SDK is run within an iframe, authentication uses a popup because many identity providers block login pages inside frames (`X-Frame-Options` / `frame-ancestors`). If popups are blocked, the SDK attempts to continue by redirecting the top-level page; if that is also blocked by the host iframe/browser policy, authentication fails with an explicit error.
- Third-party notices are listed in `THIRD_PARTY_NOTICES.md`.
