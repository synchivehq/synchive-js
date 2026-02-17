import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from "oidc-client-ts";
import type {
  AuthState,
  AuthStateChangeListener,
  AuthStateChangeTrigger,
  AuthStateChangeUnsubscribe,
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
  if (params?.orderby) url.searchParams.set("orderby", params.orderby);
  return url.toString();
};

const defaultBuildGetUrl = (
  shape: string,
  hiveId: string,
  baseUrl: string,
): string => {
  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(shape)}/${encodeURIComponent(hiveId)}`;
};

const defaultBuildCreateUrl = (shape: string, baseUrl: string): string => {
  return `${normalizeBaseUrl(baseUrl)}/${encodeURIComponent(shape)}`;
};

const defaultBuildUpdateUrl = (
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
  private readonly buildCreateUrl: SynchiveClientOptions["buildCreateUrl"];
  private readonly buildUpdateUrl: SynchiveClientOptions["buildUpdateUrl"];
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
    this.buildCreateUrl = options.buildCreateUrl ?? defaultBuildCreateUrl;
    this.buildUpdateUrl = options.buildUpdateUrl ?? defaultBuildUpdateUrl;
  }

  async init(): Promise<void> {
    const hasCallbackParams = this.isRedirectCallback();
    const isPopupWindow = this.isPopupContext();
    if (!hasCallbackParams && !isPopupWindow) return;

    try {
      await this.handleAuthCallback();
      if (hasCallbackParams) {
        this.clearAuthParamsFromUrl();
      }
    } catch (error) {
      // Popup callback pages can lose URL params in some preview/router setups.
      // In that case, best effort close so users are not left on a stale popup UI.
      if (isPopupWindow && this.isMissingCallbackStateError(error)) {
        window.close();
        return;
      }
      throw error;
    }
  }

  async signInRedirect(): Promise<void> {
    if (this.isInIframe()) {
      await this.signInWithPopupOrRedirectFallback();
      return;
    }

    await this.signInWithRedirect();
  }

  async signOutRedirect(): Promise<void> {
    await this.userManager.signoutRedirect();
  }

  async getUser(): Promise<User | null> {
    return this.userManager.getUser();
  }

  onAuthStateChange(
    listener: AuthStateChangeListener,
  ): AuthStateChangeUnsubscribe {
    const events = this.userManager.events;
    let isSubscribed = true;

    const emitState = (user: User | null): void => {
      if (!isSubscribed) return;
      const trigger = this.toAuthStateChangeTrigger(user);
      listener(this.toAuthState(user), trigger);
    };

    const emitCurrentState = async (): Promise<void> => {
      const user = await this.userManager.getUser();
      if (!isSubscribed) return;
      emitState(user);
    };

    const handleUserLoaded = (user: User): void => {
      emitState(user);
    };

    const handleUserUnloaded = (): void => {
      void emitCurrentState();
    };

    const handleUserSignedOut = (): void => {
      void emitCurrentState();
    };

    const handleAccessTokenExpired = (): void => {
      void emitCurrentState();
    };

    const handleSilentRenewError = (): void => {
      void emitCurrentState();
    };

    events.addUserLoaded(handleUserLoaded);
    events.addUserUnloaded(handleUserUnloaded);
    events.addUserSignedOut(handleUserSignedOut);
    events.addAccessTokenExpired(handleAccessTokenExpired);
    events.addSilentRenewError(handleSilentRenewError);

    void emitCurrentState();

    return () => {
      isSubscribed = false;
      events.removeUserLoaded(handleUserLoaded);
      events.removeUserUnloaded(handleUserUnloaded);
      events.removeUserSignedOut(handleUserSignedOut);
      events.removeAccessTokenExpired(handleAccessTokenExpired);
      events.removeSilentRenewError(handleSilentRenewError);
    };
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

  async create<T>(shape: string, payload: T): Promise<T> {
    const url =
      this.buildCreateUrl?.(shape, this.apiBaseUrl) ??
      defaultBuildCreateUrl(shape, this.apiBaseUrl);
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
    const url =
      this.buildUpdateUrl?.(shape, hiveId, this.apiBaseUrl) ??
      defaultBuildUpdateUrl(shape, hiveId, this.apiBaseUrl);
    return this.request<T>(url, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
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

  private toAuthState(user: User | null): AuthState {
    const activeUser = user && !user.expired ? user : null;
    return {
      user: activeUser,
      isAuthenticated: !!activeUser,
    };
  }

  private toAuthStateChangeTrigger(user: User | null): AuthStateChangeTrigger {
    return user && !user.expired ? "authenticated" : "unauthenticated";
  }

  private isRedirectCallback(): boolean {
    if (typeof window === "undefined") return false;
    if (!window.location) return false;

    const params = this.getAuthParamsFromLocation();
    return (
      params.has("code") ||
      params.has("state") ||
      params.has("error") ||
      params.has("id_token")
    );
  }

  private getAuthParamsFromLocation(): URLSearchParams {
    if (typeof window === "undefined") return new URLSearchParams();

    const params = new URLSearchParams(window.location.search);
    if (params.toString()) return params;

    const hash = window.location.hash;
    if (!hash) return params;

    const hashValue = hash.startsWith("#") ? hash.slice(1) : hash;
    const queryIndex = hashValue.indexOf("?");
    if (queryIndex >= 0) {
      return new URLSearchParams(hashValue.slice(queryIndex + 1));
    }

    // Some providers/router stacks put auth params directly in the hash fragment.
    if (hashValue.includes("code=") || hashValue.includes("state=")) {
      return new URLSearchParams(hashValue);
    }

    return params;
  }

  private isInIframe(): boolean {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      // Cross-origin access can throw, which still means "framed".
      return true;
    }
  }

  private isPopupContext(): boolean {
    if (typeof window === "undefined") return false;
    return !!window.opener && window.opener !== window;
  }

  private isMissingCallbackStateError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes("no state in response") ||
      message.includes("state not found in storage") ||
      message.includes("invalid response_type in state")
    );
  }

  private async signInWithPopupOrRedirectFallback(): Promise<void> {
    try {
      await this.userManager.signinPopup();
      return;
    } catch (error) {
      if (!this.shouldFallbackFromPopup(error)) {
        throw error;
      }
    }

    await this.signInWithRedirect();
  }

  private shouldFallbackFromPopup(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes("popup") ||
      message.includes("window closed") ||
      message.includes("window.open returned null")
    );
  }

  private async signInWithRedirect(): Promise<void> {
    const isIframe = typeof window !== "undefined" && this.isInIframe();
    try {
      await this.userManager.signinRedirect({
        redirectTarget: isIframe ? "top" : "self",
        redirectMethod: "assign",
      });
    } catch {
      if (isIframe) {
        throw new Error(
          "Embedded login blocked by frame policy. Popup auth failed and top-level navigation is not allowed in this iframe.",
        );
      }
      throw new Error("Sign-in redirect failed.");
    }
  }

  private clearAuthParamsFromUrl(): void {
    if (typeof window === "undefined") return;
    if (!window.history?.replaceState) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("session_state");
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");

    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (hash) {
      const queryIndex = hash.indexOf("?");
      if (queryIndex >= 0) {
        const route = hash.slice(0, queryIndex);
        const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
        hashParams.delete("code");
        hashParams.delete("state");
        hashParams.delete("session_state");
        hashParams.delete("error");
        hashParams.delete("error_description");
        const cleaned = hashParams.toString();
        url.hash = route
          ? cleaned
            ? `#${route}?${cleaned}`
            : `#${route}`
          : cleaned
            ? `#${cleaned}`
            : "";
      } else if (hash.includes("=")) {
        const hashParams = new URLSearchParams(hash);
        hashParams.delete("code");
        hashParams.delete("state");
        hashParams.delete("session_state");
        hashParams.delete("error");
        hashParams.delete("error_description");
        const cleaned = hashParams.toString();
        url.hash = cleaned ? `#${cleaned}` : "";
      }
    }

    window.history.replaceState({}, document.title, url.toString());
  }

  private async handleAuthCallback(): Promise<void> {
    if (this.isPopupContext()) {
      await this.userManager.signinPopupCallback();
      return;
    }

    await this.userManager.signinCallback();
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
