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
await synchive.init();

// Start login
await synchive.signInRedirect();

// Data helpers
const products = await synchive.list("Product", {
  top: 20,
  skip: 0,
  filter: "Name eq 'Widget'",
});
const product = await synchive.get("Product", "D6BFA0AB71A1");
```

Most apps only need `init()`, `signInRedirect()`, `list()`, and `get()`.

## Helpers

Common

- `init(): Promise<void>`
- `signInRedirect(): Promise<void>`
- `list<T>(shape: string, params?: { top?: number; skip?: number; filter?: string }): Promise<T[] | { value: T[] }>`
- `get<T>(shape: string, hiveId: string): Promise<T>`

Advanced

- `signOutRedirect(): Promise<void>`
- `getUser(): Promise<User | null>`

## Notes

- Tokens are stored in `localStorage` using `oidc-client-ts`. Be aware any XSS in your app can expose these tokens.
- `init()` auto-detects the OAuth redirect callback (by presence of `code/state`) and cleans up the URL.
- Third-party notices are listed in `THIRD_PARTY_NOTICES.md`.
