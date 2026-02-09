# SyncHive JS SDK

JavaScript SDK for authenticating and communicating securely with the SyncHive.

## Install

```bash
npm install synchive-js-sdk
```

## Usage

```ts
import { SyncHiveClient } from "synchive-js-sdk";

const synchive = new SyncHiveClient({
  publishableKey: "sh_publishable_c2hrX2xpdmVf...ODo",
});

// Initialize the client (handles auth callbacks automatically)
try {
  await synchive.init();
} catch (error) {
  // Surface sign-in callback errors to the user
  console.error("Auth failed:", error);
}

// Simple logged-in / logged-out UI logic
const user = await synchive.getUser();
const isLoggedIn = !!user && !user.expired;

if (isLoggedIn) {
  // Render logged-in UI
  // Example:
  // onSignOutClick -> await synchive.signOutRedirect();
} else {
  // Render logged-out UI with a Sign In action
  // Example:
  // onSignInClick -> await synchive.signInRedirect();
}

// Data helpers
try {
  const products = await synchive.list("Product", {
    top: 20,
    skip: 0,
    filter: "Name eq 'Widget'",
  });
  const product = await synchive.get("Product", "D6BFA0AB71A1");
} catch (error) {
  // Surface data errors to the user
  console.error("Data load failed:", error);
}
```

Most apps only need `init()`, `signInRedirect()`, `list()`, and `get()`.

## Helpers

Common

- `init(): Promise<void>`
- `signInRedirect(): Promise<void>`
- `list<T>(shape: string, params?: { top?: number; skip?: number; filter?: string }): Promise<{ shapes: T[]; pagination: { totalItems?: number; totalPages?: number; pageNumber?: number; pageSize?: number } }>`
- `get<T>(shape: string, hiveId: string): Promise<T>`

Advanced

- `signOutRedirect(): Promise<void>`
- `getUser(): Promise<User | null>`

## Notes

- Tokens are stored in `localStorage` using `oidc-client-ts`. Be aware any XSS in your app can expose these tokens.
- `init()` runs only on the sign-in callback and throws if the sign-in failed. Wrap it in `try/catch` to show a user-friendly message.
- Third-party notices are listed in `THIRD_PARTY_NOTICES.md`.
