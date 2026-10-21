import {
  PasswordAuth,
  type PasswordChange,
  type PasswordCredentials,
  type PasswordResetCompletion,
  type PasswordResetRequest,
  type PasswordSignUp,
  type RegistrationCompletion,
  type VerificationResend,
} from "./auth/password";
import { decodePublishableKey, getApiBaseUrl, getApisHost } from "./publishableKey";
import type {
  AppUser,
  AppUserCollection,
  AppUserListParams,
  AppUserUpdate,
  AppRoleCollection,
  AppRoleListParams,
  SyncHivePermissions,
  SyncHiveRoleAssignment,
  SyncHiveManagementError,
  AuthState,
  AuthStateChangeListener,
  AuthStateChangeTrigger,
  AuthStateChangeUnsubscribe,
  DownloadedFile,
  DownloadFileResult,
  FetchLike,
  ListParams,
  ListResult,
  SyncHiveUser,
  SynchiveClientOptions,
  UploadFileRequest,
  UploadFileResult,
} from "./types";
import { applyTenantAppBasePathToApiBaseUrl, normalizeBaseUrl } from "./urls";

const defaultBuildListUrl = (
  shape: string,
  params: ListParams | undefined,
  baseUrl: string,
): string => {
  const url = new URL(
    `${normalizeBaseUrl(baseUrl)}/shape/${encodeURIComponent(shape)}`,
  );
  if (params?.top !== undefined)
    url.searchParams.set("top", String(params.top));
  if (params?.skip !== undefined)
    url.searchParams.set("skip", String(params.skip));
  if (params?.filter) url.searchParams.set("filter", params.filter);
  if (params?.orderby) url.searchParams.set("orderby", params.orderby);
  return url.toString();
};

const defaultBuildGetUrl = (
  shape: string,
  hiveId: string,
  baseUrl: string,
): string => {
  return `${normalizeBaseUrl(baseUrl)}/shape/${encodeURIComponent(shape)}/${encodeURIComponent(hiveId)}`;
};

const defaultBuildCreateUrl = (shape: string, baseUrl: string): string => {
  return `${normalizeBaseUrl(baseUrl)}/shape/${encodeURIComponent(shape)}`;
};

const defaultBuildUpdateUrl = (
  shape: string,
  hiveId: string,
  baseUrl: string,
): string => {
  return `${normalizeBaseUrl(baseUrl)}/shape/${encodeURIComponent(shape)}/${encodeURIComponent(hiveId)}`;
};

const defaultBuildFilesBaseUrl = (baseUrl: string): string => {
  return `${normalizeBaseUrl(baseUrl)}/files`;
};

const defaultBuildUploadFileUrl = (baseUrl: string): string => {
  return `${defaultBuildFilesBaseUrl(baseUrl)}/upload-url`;
};

const defaultBuildDownloadFileUrl = (
  fileHiveId: string,
  baseUrl: string,
): string => {
  return `${defaultBuildFilesBaseUrl(baseUrl)}/${encodeURIComponent(fileHiveId)}/download-url`;
};

const defaultBuildDeleteFileUrl = (
  fileHiveId: string,
  baseUrl: string,
): string => {
  return `${defaultBuildFilesBaseUrl(baseUrl)}/${encodeURIComponent(fileHiveId)}`;
};

const getDefaultStorage = (): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  if (window.localStorage) return window.localStorage;
  return undefined;
};

const getDefaultFetch = (): FetchLike => {
  if (typeof fetch === "function") return fetch.bind(globalThis);
  throw new Error("Fetch API is not available in this environment.");
};

export class SyncHiveClient {
  private readonly apiBaseUrl: string;
  private readonly authBaseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly auth: PasswordAuth;

  constructor(options: SynchiveClientOptions) {
    const publishableKey = options.publishableKey?.trim();
    if (!publishableKey) {
      throw new Error("publishableKey is required.");
    }

    const parsedPublishableKey = decodePublishableKey(publishableKey);
    const apiBaseUrl = applyTenantAppBasePathToApiBaseUrl(
      getApiBaseUrl(parsedPublishableKey),
    );

    const storage = options.storage ?? getDefaultStorage();
    if (!storage) {
      throw new Error(
        "Storage is required (localStorage recommended for browser usage).",
      );
    }

    this.apiBaseUrl = apiBaseUrl;
    this.authBaseUrl = `${getApisHost(parsedPublishableKey)}/v1/hives/${encodeURIComponent(parsedPublishableKey.tenantHiveId)}/auth`;
    this.fetchFn = options.fetch ?? getDefaultFetch();
    this.auth = new PasswordAuth({
      publishableKey,
      parsed: parsedPublishableKey,
      storage,
      fetchFn: this.fetchFn,
    });
  }

  async init(): Promise<void> {
    await this.auth.init();
  }

  async signInWithPassword(credentials: PasswordCredentials): Promise<void> {
    await this.auth.signInWithPassword(credentials);
  }

  /** Registers the user and emails them a link to verificationPageUrl. They aren't signed in until completeRegistration(). */
  async signUpWithPassword(signUp: PasswordSignUp): Promise<void> {
    await this.auth.signUpWithPassword(signUp);
  }

  /** Emails a new verification link. The previous link stops working. */
  async resendVerification(resend: VerificationResend): Promise<void> {
    await this.auth.resendVerification(resend);
  }

  /** Confirms the user's email with the token from the verification link, and signs them in. */
  async completeRegistration(
    completion: RegistrationCompletion,
  ): Promise<void> {
    await this.auth.completeRegistration(completion);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  /** Changes the signed-in user's password. They stay signed in. */
  async changePassword(change: PasswordChange): Promise<void> {
    await this.auth.changePassword(change);
  }

  /** Emails the user a link to passwordResetPageUrl carrying a single-use reset token. */
  async requestPasswordReset(request: PasswordResetRequest): Promise<void> {
    await this.auth.requestPasswordReset(request);
  }

  /** Sets a new password using the reset token. The user must sign in afterwards. */
  async completePasswordReset(
    completion: PasswordResetCompletion,
  ): Promise<void> {
    await this.auth.completePasswordReset(completion);
  }

  async getUser(): Promise<SyncHiveUser | null> {
    return this.auth.getUser();
  }

  /** Current permission and Role/Policy names in this app's Scope. Always fetches from the server. */
  async getPermissions(): Promise<SyncHivePermissions> {
    return this.request<SyncHivePermissions>(
      `${this.authBaseUrl}/me`,
      { cache: "no-store" },
      true,
    );
  }

  async listAppUsers(params?: AppUserListParams): Promise<AppUserCollection> {
    return this.managementRequest<AppUserCollection>("/auth-users", {}, params);
  }

  async getAppUser(accountHiveId: string): Promise<AppUser> {
    return this.managementRequest<AppUser>(
      `/auth-users/${encodeURIComponent(accountHiveId)}`,
    );
  }

  /** Updates administrative status. Role assignments use assignAppUserRole/removeAppUserRole. */
  async updateAppUser(
    accountHiveId: string,
    update: AppUserUpdate,
  ): Promise<AppUser> {
    return this.managementRequest<AppUser>(
      `/auth-users/${encodeURIComponent(accountHiveId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/merge-patch+json" },
        body: JSON.stringify(update),
      },
    );
  }

  async deleteAppUser(accountHiveId: string): Promise<void> {
    return this.managementRequest<void>(
      `/auth-users/${encodeURIComponent(accountHiveId)}`,
      { method: "DELETE" },
    );
  }

  /** Adds one assignment idempotently, preserving every other membership. */
  async assignAppUserRole(
    accountHiveId: string,
    roleId: number,
  ): Promise<SyncHiveRoleAssignment> {
    return this.managementRequest<SyncHiveRoleAssignment>(
      `/auth-users/${encodeURIComponent(accountHiveId)}/roles/${encodeURIComponent(String(roleId))}`,
      { method: "PUT", body: "{}" },
    );
  }

  async removeAppUserRole(accountHiveId: string, roleId: number): Promise<void> {
    return this.managementRequest<void>(
      `/auth-users/${encodeURIComponent(accountHiveId)}/roles/${encodeURIComponent(String(roleId))}`,
      { method: "DELETE" },
    );
  }

  async listAppRoles(params?: AppRoleListParams): Promise<AppRoleCollection> {
    return this.managementRequest<AppRoleCollection>("/auth-roles", {}, params);
  }

  async listRoleMembers(
    roleId: number,
    params?: AppUserListParams,
  ): Promise<AppUserCollection> {
    return this.managementRequest<AppUserCollection>(
      `/auth-roles/${encodeURIComponent(String(roleId))}/members`,
      {},
      params,
    );
  }

  private managementRequest<T>(
    path: string,
    init: RequestInit = {},
    params?: AppUserListParams | AppRoleListParams,
  ): Promise<T> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return this.request<T>(url.toString(), { cache: "no-store", ...init }, true);
  }

  onAuthStateChange(
    listener: AuthStateChangeListener,
  ): AuthStateChangeUnsubscribe {
    return this.auth.onUserChange((user) => {
      listener(this.toAuthState(user), this.toAuthStateChangeTrigger(user));
    });
  }

  async list<T>(shape: string, params?: ListParams): Promise<ListResult<T>> {
    const url = defaultBuildListUrl(shape, params, this.apiBaseUrl);
    return this.request<ListResult<T>>(url);
  }

  async get<T>(shape: string, hiveId: string): Promise<T> {
    const url = defaultBuildGetUrl(shape, hiveId, this.apiBaseUrl);
    return this.request<T>(url);
  }

  async create<T>(shape: string, payload: T): Promise<T> {
    const url = defaultBuildCreateUrl(shape, this.apiBaseUrl);
    return this.request<T>(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async update<T>(
    shape: string,
    hiveId: string,
    payload: Partial<T> | T,
  ): Promise<T> {
    const url = defaultBuildUpdateUrl(shape, hiveId, this.apiBaseUrl);
    return this.request<T>(url, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async uploadFile(
    file: File,
    options?: { fileHiveId?: string },
  ): Promise<UploadFileResult> {
    const upload = await this.createUploadUrl({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
      fileHiveId: options?.fileHiveId,
    });

    const response = await this.fetchFn(upload.uploadUrl, {
      method: "PUT",
      headers: { "X-SH-Upload-Token": upload.uploadToken },
      body: file,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`File upload failed (${response.status}): ${text}`);
    }

    return upload;
  }

  async downloadFile(fileHiveId: string): Promise<DownloadedFile> {
    const download = await this.createDownloadUrl(fileHiveId);
    const response = await this.fetchFn(download.downloadUrl);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`File download failed (${response.status}): ${text}`);
    }

    return {
      fileHiveId: download.fileHiveId,
      fileName: download.fileName,
      fileSize: download.fileSize,
      contentType: download.contentType,
      blob: await response.blob(),
    };
  }

  async deleteFile(fileHiveId: string): Promise<void> {
    const url = defaultBuildDeleteFileUrl(fileHiveId, this.apiBaseUrl);
    return this.request<void>(url, { method: "DELETE" });
  }

  async createUploadUrl(payload: UploadFileRequest): Promise<UploadFileResult> {
    const url = defaultBuildUploadFileUrl(this.apiBaseUrl);
    return this.request<UploadFileResult>(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async createDownloadUrl(fileHiveId: string): Promise<DownloadFileResult> {
    const url = defaultBuildDownloadFileUrl(fileHiveId, this.apiBaseUrl);
    return this.request<DownloadFileResult>(url);
  }

  private async request<T>(
    url: string,
    init: RequestInit = {},
    managementErrors = false,
  ): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    await this.auth.authorize(headers);
    headers.set("Accept", "application/json");

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetchFn(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      if (managementErrors) {
        let problem: Record<string, unknown> = {};
        try {
          problem = JSON.parse(text) ?? {};
        } catch {
          // Preserve the HTTP status when the response is not JSON.
        }
        const detail = typeof problem.detail === "string" ? problem.detail : undefined;
        const error = new Error(
          detail ?? `App User management request failed (${response.status}).`,
        ) as SyncHiveManagementError;
        error.status = response.status;
        error.title = typeof problem.title === "string" ? problem.title : undefined;
        error.detail = detail;
        error.code = typeof problem.code === "string" ? problem.code : undefined;
        throw error;
      }
      throw new Error(`Request failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private toAuthState(user: SyncHiveUser | null): AuthState {
    const activeUser = user && !user.expired ? user : null;
    return {
      user: activeUser,
      isAuthenticated: !!activeUser,
    };
  }

  private toAuthStateChangeTrigger(
    user: SyncHiveUser | null,
  ): AuthStateChangeTrigger {
    return user && !user.expired ? "authenticated" : "unauthenticated";
  }
}
