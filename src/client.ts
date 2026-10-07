import { PasswordAuth, type PasswordCredentials } from "./auth/password";
import { decodePublishableKey, getApiBaseUrl } from "./publishableKey";
import type {
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

  /** Registers the user; they are signed in after following the confirmation email back to the app. */
  async signUpWithPassword(credentials: PasswordCredentials): Promise<void> {
    await this.auth.signUpWithPassword(credentials);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  async getUser(): Promise<SyncHiveUser | null> {
    return this.auth.getUser();
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

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
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
