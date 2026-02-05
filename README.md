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
  autoHandleRedirect: true,
  redirectPath: "/auth/callback",
});

// Automatically handles the auth callback
await synchive.init();

// Start login
await synchive.signInRedirect();

// Data helpers
const products = await synchive.list("SalesOrder", {
  top: 20,
  skip: 0,
  filter: "Name eq 'Widget'",
});
const product = await synchive.get("SalesOrder", "hive-id-123");
```

Most apps only need `init()`, `signInRedirect()`, `list()`, and `get()`.

## Helpers

Common

- `init(): Promise<void>`
- `signInRedirect(): Promise<void>`
- `list<T>(shape: string, params?: { top?: number; skip?: number; filter?: string }): Promise<T[] | { value: T[] }>`
- `get<T>(shape: string, hiveId: string): Promise<T>`

Advanced

- `handleRedirectCallback(): Promise<User>`
- `signOutRedirect(): Promise<void>`
- `handleSilentCallback(): Promise<void>`
- `getUser(): Promise<User | null>`

## Notes

- Tokens are stored in `localStorage` using `oidc-client-ts`. Be aware any XSS in your app can expose these tokens.
- `init()` auto-detects the OAuth redirect callback (by `redirectPath` and presence of `code/state`) and cleans up the URL.
