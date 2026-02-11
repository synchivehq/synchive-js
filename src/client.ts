import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from "oidc-client-ts";
import type {
  FetchLike,
  ListParams,
  ListResult,
  SynchiveClientOptions,
} from "./types";

const normalizeBaseUrl = (baseUrl: string): string => {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
};

const defaultBuildListUrl = (
  shape: string,
  params: ListParams | undefined,
  baseUrl: string,
): string => {
  const url = new URL(
    `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(shape)}`,
  );
  if (params?.top !== undefined)
    url.searchParams.set("top", String(params.top));
  if (params?.skip !== undefined)
    url.searchParams.set("skip", String(params.skip));
  if (params?.filter) url.searchParams.set("filter", params.filter);
  return url.toString();
};

const defaultBuildGetUrl = (
  shape: string,
  hiveId: string,
  baseUrl: string,
): string => {
  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(shape)}/${encodeURIComponent(hiveId)}`;
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
  private readonly buildListUrl: SynchiveClientOptions["buildListUrl"];
  private readonly buildGetUrl: SynchiveClientOptions["buildGetUrl"];
  private readonly userManager: UserManager;

  constructor(options: SynchiveClientOptions) {
    const publishableKey = options.publishableKey?.trim();
    const derived = publishableKey
      ? decodePublishableKey(publishableKey)
      : undefined;
    const derivedApiBaseUrl = derived
      ? `https://apis.${derived.environment}.synchive.com/v1/shape`
      : undefined;
    const apiBaseUrl = options.apiBaseUrl ?? derivedApiBaseUrl;
    if (!apiBaseUrl) {
      throw new Error(
        "apiBaseUrl is required (or provide publishableKey to derive it).",
      );
    }

    const storage = options.storage ?? getDefaultStorage();
    if (!storage) {
      throw new Error(
        "Storage is required (localStorage recommended for browser usage).",
      );
    }

    const auth = resolveAuthSettings({
      publishableKey,
      derived,
      options,
      storage,
    });

    this.userManager = new UserManager(auth);
    this.apiBaseUrl = apiBaseUrl;
    this.fetchFn = options.fetch ?? getDefaultFetch();
    this.buildListUrl = options.buildListUrl ?? defaultBuildListUrl;
    this.buildGetUrl = options.buildGetUrl ?? defaultBuildGetUrl;
  }

  async init(): Promise<void> {
    if (!this.isRedirectCallback()) return;
    await this.handleRedirectCallback();
    this.clearAuthParamsFromUrl();
  }

  async signInRedirect(): Promise<void> {
    await this.userManager.signinRedirect();
  }

  async signOutRedirect(): Promise<void> {
    await this.userManager.signoutRedirect();
  }

  async getUser(): Promise<User | null> {
    return this.userManager.getUser();
  }

  async list<T>(shape: string, params?: ListParams): Promise<ListResult<T>> {
    const url =
      this.buildListUrl?.(shape, params, this.apiBaseUrl) ??
      defaultBuildListUrl(shape, params, this.apiBaseUrl);
    return this.request<ListResult<T>>(url);
  }

  async get<T>(shape: string, hiveId: string): Promise<T> {
    const url =
      this.buildGetUrl?.(shape, hiveId, this.apiBaseUrl) ??
      defaultBuildGetUrl(shape, hiveId, this.apiBaseUrl);
    return this.request<T>(url);
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const user = await this.ensureUser();
    const token = user.access_token;
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
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

  private async ensureUser(): Promise<User> {
    const user = await this.userManager.getUser();
    if (user && !user.expired) return user;

    try {
      const renewed = await this.userManager.signinSilent();
      if (renewed && !renewed.expired) return renewed;
    } catch {
      // Ignore silent renew failures and fall through to error.
    }

    throw new Error("User is not authenticated. Call signInRedirect() first.");
  }

  private isRedirectCallback(): boolean {
    if (typeof window === "undefined") return false;
    if (!window.location) return false;

    const params = new URLSearchParams(window.location.search);
    return params.has("code") || params.has("state");
  }

  private clearAuthParamsFromUrl(): void {
    if (typeof window === "undefined") return;
    if (!window.history?.replaceState) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("session_state");
    window.history.replaceState({}, document.title, url.toString());
  }

  private async handleRedirectCallback(): Promise<User> {
    return this.userManager.signinRedirectCallback();
  }
}

type DecodedPublishableKey = {
  encryptedKey: string;
  environment: string;
};

const PUBLISHABLE_PREFIX = "sh_publishable_";

const decodePublishableKey = (
  publishableKey: string,
): DecodedPublishableKey => {
  if (!publishableKey.startsWith(PUBLISHABLE_PREFIX)) {
    throw new Error("publishableKey is invalid or missing required prefix.");
  }

  const encoded = publishableKey.slice(PUBLISHABLE_PREFIX.length);
  let decoded: string;
  try {
    decoded = atob(normalizeBase64(encoded));
  } catch {
    throw new Error("publishableKey is not valid base64.");
  }

  const parts = decoded.split("::");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("publishableKey payload is invalid.");
  }

  return {
    encryptedKey: parts[0],
    environment: parts[1],
  };
};

const normalizeBase64 = (value: string): string => {
  // Support base64url and non-standard variants from external sources.
  let normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\|/g, "/");
  const padding = normalized.length % 4;
  if (padding) {
    normalized += "=".repeat(4 - padding);
  }
  return normalized;
};

const resolveAuthSettings = (input: {
  publishableKey?: string;
  derived?: DecodedPublishableKey;
  options: SynchiveClientOptions;
  storage: Storage;
}): UserManagerSettings => {
  if (input.options.auth) {
    return {
      ...input.options.auth,
      userStore: new WebStorageStateStore({ store: input.storage }),
      stateStore: new WebStorageStateStore({ store: input.storage }),
    };
  }

  if (!input.publishableKey || !input.derived) {
    throw new Error("Either auth or publishableKey must be provided.");
  }

  if (typeof window === "undefined") {
    throw new Error("publishableKey auth requires a browser environment.");
  }

  const authority = `https://apis.${input.derived.environment}.synchive.com/v1/auth/`;

  const defaults: UserManagerSettings = {
    authority,
    client_id: input.publishableKey,
    redirect_uri: new URL(window.location.origin).toString(),
    silent_redirect_uri: new URL(window.location.origin).toString(),
    response_type: "code",
    scope: "openid profile offline_access",
  };

  return {
    ...defaults,
    ...input.options.authOverrides,
    userStore: new WebStorageStateStore({ store: input.storage }),
    stateStore: new WebStorageStateStore({ store: input.storage }),
  };
};
