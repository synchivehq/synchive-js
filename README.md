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
  publishableKey: "sh_publishable_v2_us-west-2_cHJvZDo6...",
});

// Initialize the client on every page load. This restores any saved session,
// and completes sign-up when the user arrives from the confirmation email.
try {
  await synchive.init();
} catch (error) {
  // Surface confirmation errors to the user
  console.error("Email confirmation failed:", error);
}

// Sign up with email and password. SyncHive emails a confirmation link back
// to your app, and init() signs the user in when they follow it.
try {
  await synchive.signUpWithPassword({ email, password });
  // Tell the user to check their email
} catch (error) {
  // Surface sign-up errors to the user
  console.error("Sign-up failed:", error);
}

// Sign in with email and password
try {
  await synchive.signInWithPassword({ email, password });
} catch (error) {
  // Surface sign-in errors to the user
  console.error("Sign-in failed:", error);
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

// File helpers
try {
  const uploaded = await synchive.uploadFile(file);
  const downloaded = await synchive.downloadFile(uploaded.fileHiveId);
  // Downloaded blob to save, preview, etc
  await synchive.deleteFile(uploaded.fileHiveId);
} catch (error) {
  // Surface file errors to the user
  console.error("File operation failed:", error);
}
```

Most apps only need `init()`, `onAuthStateChange()`, `signInWithPassword()`, `signUpWithPassword()`, `list()`, `get()`, `create()`, and `update()`.

## Helpers

Common

- `init(): Promise<void>`
- `onAuthStateChange(listener: AuthStateChangeListener): AuthStateChangeUnsubscribe` (returns a cleanup callback)
- `signInWithPassword(credentials: { email: string; password: string }): Promise<void>`
- `signUpWithPassword(credentials: { email: string; password: string }): Promise<void>`
- `signOut(): Promise<void>`
- `list<T>(shape: string, params?: { top?: number; skip?: number; filter?: string; orderby?: string }): Promise<{ shapes: T[]; pagination: { totalItems?: number; totalPages?: number; pageNumber?: number; pageSize?: number } }>`
- `get<T>(shape: string, hiveId: string): Promise<T>`
- `create<T>(shape: string, payload: T): Promise<T>`
- `update<T>(shape: string, hiveId: string, payload: Partial<T> | T): Promise<T>`
- `uploadFile(file: File, options?: { fileHiveId?: string }): Promise<{ fileHiveId: string; uploadUrl: string; uploadToken: string; expiresOn: string }>`
- `downloadFile(fileHiveId: string): Promise<{ fileHiveId: string; fileName: string; fileSize: number; contentType?: string; blob: Blob }>`
- `deleteFile(fileHiveId: string): Promise<void>`

Advanced

- `getUser(): Promise<SyncHiveUser | null>`
- `createUploadUrl(payload: { fileName: string; contentType: string; fileSize: number; fileHiveId?: string }): Promise<{ fileHiveId: string; uploadUrl: string; uploadToken: string; expiresOn: string }>`
- `createDownloadUrl(fileHiveId: string): Promise<{ fileHiveId: string; fileName: string; fileSize: number; contentType?: string; downloadUrl: string; expiresOn: string }>`

## Notes

- Tokens are stored in `localStorage`. Be aware any XSS in your app can expose these tokens.
- `init()` restores the stored session, and completes sign-in when the user returns from the sign-up confirmation email. It throws if that confirmation fails, so wrap it in `try/catch` to show a user-friendly message.
- `signInWithPassword()` throws a `SyncHiveAuthError` with `code` `email_not_verified` if the user hasn't confirmed their email yet.
- `signUpWithPassword()` throws a `SyncHiveAuthError` with `code` `email_already_exists` if the email already has a confirmed account. Offer sign-in instead.
- `onAuthStateChange()` calls your listener immediately with current state, then again whenever auth state changes.
- Auth lifecycle event names are exported as SDK types via `AuthStateChangeTrigger`: `"authenticated"` and `"unauthenticated"`.
- On initial mount, the first emitted event can be either `"authenticated"` or `"unauthenticated"` depending on whether a valid session already exists.
- `uploadFile()` / `downloadFile()` are convenience wrappers: they call `createUploadUrl()` / `createDownloadUrl()` for you, then PUT/fetch the file bytes to/from that URL.
- `createUploadUrl()` / `createDownloadUrl()` are for when you need more control over the file transfer than `uploadFile()` / `downloadFile()` give you — e.g. tracking upload progress via `XMLHttpRequest`'s `upload.onprogress`.

## Upgrading from 1.x

- 2.x requires a V2 publishable key (`sh_publishable_v2_...`). V1 keys throw an error.
- `signInRedirect()` and `signOutRedirect()` are replaced by `signInWithPassword()`, `signUpWithPassword()` and `signOut()`.
- `SyncHiveUser` fields are renamed: `profile.sub` is now `id`, `profile.email` is `email`, `profile.name` is `name`, `profile` is `claims`, and `access_token` is `accessToken`. `expires_at` (seconds) is now `expiresAt` (milliseconds).
