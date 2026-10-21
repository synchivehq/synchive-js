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

// Initialize the client on every page load. This restores any saved session.
await synchive.init();

// Sign up: email the user a link to verificationPageUrl carrying a verification token.
try {
  await synchive.signUpWithPassword({
    email,
    password,
    // Must be one of your app's allowed App URLs in SyncHive
    verificationPageUrl: `${location.origin}/verify-email`,
  });
  // Tell the user to check their email
} catch (error) {
  // Surface sign-up errors to the user
  console.error("Sign-up failed:", error);
}

// Sign up: on the verification page (configured above), read the "sh_verification_token" token from URL params and complete the registration.
const verificationToken = new URLSearchParams(location.search).get(
  "sh_verification_token",
);
if (verificationToken) {
  try {
    await synchive.completeRegistration({ token: verificationToken });
    // The user is now signed in
  } catch (error) {
    // On registration_password_required, ask for the password they signed up with and try again.
    // Surface other errors, e.g. a superseded link, to the user
    console.error("Email confirmation failed:", error);
  }
} else {
  // Tell the user the link is missing or broken, and offer to send a new one
}

// Sign up: send a new verification email.
try {
  await synchive.resendVerification({
    email,
    // Must be one of your app's allowed App URLs in SyncHive
    verificationPageUrl: `${location.origin}/verify-email`,
  });
} catch (error) {
  console.error("Resending verification failed:", error);
}

// Sign in with email and password.
try {
  await synchive.signInWithPassword({ email, password });
} catch (error) {
  // Surface sign-in errors to the user
  console.error("Sign-in failed:", error);
}

// Forgot password: email the user a link to passwordResetPageUrl carrying a single-use reset token.
try {
  await synchive.requestPasswordReset({
    email,
    // Must be one of your app's allowed App URLs in SyncHive
    passwordResetPageUrl: `${location.origin}/reset-password`,
  });
  // Tell the user to check their email
} catch (error) {
  console.error("Password reset request failed:", error);
}

// Forgot password: on the password reset page (configured above), read the "sh_password_reset_token" token from URL params and complete the password reset.
const resetToken = new URLSearchParams(location.search).get(
  "sh_password_reset_token",
);
if (resetToken) {
  try {
    await synchive.completePasswordReset({ token: resetToken, newPassword });
    // Ask the user to sign in with their new password
  } catch (error) {
    // Surface reset errors, e.g. an expired link, to the user
    console.error("Password reset failed:", error);
  }
} else {
  // Tell the user the link is missing or broken, and offer to send a new one
}

// Change the signed-in user's password.
try {
  await synchive.changePassword({ currentPassword, newPassword });
} catch (error) {
  console.error("Password change failed:", error);
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

// User permissions and management
try {
  const permissions = await synchive.getPermissions();
  const users = await synchive.listAppUsers({ top: 20 });
  // Assigning Roles requires EDIT permission.
  await synchive.assignAppUserRole(accountHiveId, roleId);
} catch (error) {
  console.error("User management failed:", error);
}

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

## Helpers

Common

- `init(): Promise<void>`
- `onAuthStateChange(listener: AuthStateChangeListener): AuthStateChangeUnsubscribe` (returns a cleanup callback)
- `signInWithPassword(credentials: { email: string; password: string }): Promise<void>`
- `signUpWithPassword(signUp: { email: string; password: string; verificationPageUrl: string }): Promise<void>`
- `completeRegistration(completion: { token: string; password?: string }): Promise<void>`
- `resendVerification(resend: { email: string; verificationPageUrl: string }): Promise<void>`
- `signOut(): Promise<void>`
- `changePassword(change: { currentPassword: string; newPassword: string }): Promise<void>`
- `requestPasswordReset(request: { email: string; passwordResetPageUrl: string }): Promise<void>`
- `completePasswordReset(completion: { token: string; newPassword: string }): Promise<void>`
- `list<T>(shape: string, params?: { top?: number; skip?: number; filter?: string; orderby?: string }): Promise<{ shapes: T[]; pagination: { totalItems?: number; totalPages?: number; pageNumber?: number; pageSize?: number } }>`
- `get<T>(shape: string, hiveId: string): Promise<T>`
- `create<T>(shape: string, payload: T): Promise<T>`
- `update<T>(shape: string, hiveId: string, payload: Partial<T> | T): Promise<T>`
- `uploadFile(file: File, options?: { fileHiveId?: string }): Promise<{ fileHiveId: string; uploadUrl: string; uploadToken: string; expiresOn: string }>`
- `downloadFile(fileHiveId: string): Promise<{ fileHiveId: string; fileName: string; fileSize: number; contentType?: string; blob: Blob }>`
- `deleteFile(fileHiveId: string): Promise<void>`
- `getCurrentUser(): Promise<SyncHiveUser | null>`

`getCurrentUser()` returns the signed-in user's access-token claims, or `null` when signed out. `getUser()` remains as a deprecated alias. `getAppUser(accountHiveId)` fetches a user management record from the server, including their enabled status and visible role assignments.

User management

- `getPermissions(): Promise<SyncHivePermissions>`
- `listAppUsers(params?: AppUserListParams): Promise<AppUserCollection>`
- `getAppUser(accountHiveId: string): Promise<AppUser>`
- `updateAppUser(accountHiveId: string, update: { isEnabled: boolean }): Promise<AppUser>`
- `deleteAppUser(accountHiveId: string): Promise<void>`
- `assignAppUserRole(accountHiveId: string, roleId: number): Promise<SyncHiveRoleAssignment>`
- `removeAppUserRole(accountHiveId: string, roleId: number): Promise<void>`
- `listAppRoles(params?: AppRoleListParams): Promise<AppRoleCollection>`
- `listRoleMembers(roleId: number, params?: AppUserListParams): Promise<AppUserCollection>`

Advanced

- `createUploadUrl(payload: { fileName: string; contentType: string; fileSize: number; fileHiveId?: string }): Promise<{ fileHiveId: string; uploadUrl: string; uploadToken: string; expiresOn: string }>`
- `createDownloadUrl(fileHiveId: string): Promise<{ fileHiveId: string; fileName: string; fileSize: number; contentType?: string; downloadUrl: string; expiresOn: string }>`

## Notes

- Tokens are stored in `localStorage`. Be aware any XSS in your app can expose these tokens.
- `init()` restores the stored session.
- Password sign-in and token refresh automatically include your configured publishable key to identify the app.
- `signUpWithPassword()`, `resendVerification()` and `requestPasswordReset()` throw a `SyncHiveAuthError` with `code` `invalid_redirect` if `verificationPageUrl` or `passwordResetPageUrl` isn't one of your app's allowed App URLs in SyncHive.
- `signInWithPassword()` throws a `SyncHiveAuthError` with `code` `account_email_not_verified` if the user hasn't confirmed their email yet.
- `signUpWithPassword()` emails a link to `verificationPageUrl` with `sh_verification_token` added to the query. It doesn't sign the user in. It throws a `SyncHiveAuthError` with `code` `email_already_in_use` if the email already has an account, including one awaiting verification, or `invalid_password` if the password doesn't meet the password policy.
- `completeRegistration()` takes the `sh_verification_token` query parameter from the verification email link, and signs the user in. When the user confirms in the same browser they signed up in, the SDK proves the sign-up for them. Otherwise it throws `registration_password_required`: ask for the password they signed up with and call it again with `password`. A wrong password throws `incorrect_password`, a link replaced by a newer one throws `superseded_verification_link`, and a used, expired or unknown link throws `invalid_confirmation`.
- `resendVerification()` emails a new link and makes the previous one stop working. It can be sent once every 60 seconds (`email_request_rate_limited` otherwise).
- `changePassword()` requires a signed-in user. It throws a `SyncHiveAuthError` with `code` `incorrect_password` if `currentPassword` is wrong, or `invalid_password` if `newPassword` doesn't meet the password policy.
- `requestPasswordReset()` emails a single-use link, valid for 24 hours, to `passwordResetPageUrl` with `sh_password_reset_token` added to the query. The account's email must be verified (`account_email_not_verified` otherwise), and a new email can be requested once every 60 seconds (`email_request_rate_limited` otherwise).
- `completePasswordReset()` takes the `sh_password_reset_token` query parameter from the reset email link. Used, expired or superseded links throw `used_password_reset_link`, `expired_password_reset_link` or `superseded_password_reset_link`. A reset signs the user out everywhere and doesn't sign them in, so send them to sign in afterwards.
- `onAuthStateChange()` calls your listener immediately with current state, then again whenever auth state changes.
- Auth lifecycle event names are exported as SDK types via `AuthStateChangeTrigger`: `"authenticated"` and `"unauthenticated"`.
- On initial mount, the first emitted event can be either `"authenticated"` or `"unauthenticated"` depending on whether a valid session already exists.
- `getPermissions()` returns the signed-in user's `appUserManagementPermission` (`NONE`, `VIEW`, or `EDIT`), plus Roles and Policies as `{ id, name }` objects.
- `getPermissions()` and user management methods return a 403 error when SyncHive Roles are disabled. `VIEW` allows viewing users and assignments; `EDIT` allows changes. Protected Roles can only be assigned by their members.
- HTTP failures from `getPermissions()` and user management methods throw the exported `SyncHiveManagementError` class, so callers can use `error instanceof SyncHiveManagementError`. It has `status` and optional `title`, `detail`, and `code` fields. Its message uses the response detail, then title, then body text, then a generic message. Authentication failures before the request and network failures propagate their original errors.
- `uploadFile()` / `downloadFile()` are convenience wrappers: they call `createUploadUrl()` / `createDownloadUrl()` for you, then PUT/fetch the file bytes to/from that URL.
- `createUploadUrl()` / `createDownloadUrl()` are for when you need more control over the file transfer than `uploadFile()` / `downloadFile()` give you — e.g. tracking upload progress via `XMLHttpRequest`'s `upload.onprogress`.

## Upgrading from 1.x

- 2.x requires a V2 publishable key (`sh_publishable_v2_...`). V1 keys throw an error.
- `signInRedirect()` and `signOutRedirect()` are replaced by `signInWithPassword()`, `signUpWithPassword()` and `signOut()`.
- `SyncHiveUser` fields are renamed: `profile.sub` is now `id`, `profile.email` is `email`, `profile.name` is `name`, `profile` is `claims`, and `access_token` is `accessToken`. `expires_at` (seconds) is now `expiresAt` (milliseconds).
