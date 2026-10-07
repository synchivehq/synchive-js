import {
  getApisHost,
  normalizeBase64,
  type ParsedPublishableKey,
} from "../publishableKey";
import type { FetchLike, SyncHiveAuthError, SyncHiveUser } from "../types";
import { getDefaultRedirectUrl } from "../urls";

export type PasswordCredentials = {
  email: string;
  password: string;
};

type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type AuthProblem = {
  title?: string;
  detail?: string;
  code?: string;
};

type Session = {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the Unix epoch. */
  expiresAt: number;
  claims: Record<string, unknown>;
};

const AUTH_CODE_PARAM = "sh_auth_code";
const REFRESH_MARGIN_SECONDS = 30;
const PUBLISHABLE_KEY_PATHS = new Set(["/sign-up/password", "/exchange"]);

/** Email and password sign-in, with sessions kept in storage and refreshed before expiry. */
export class PasswordAuth {
  private readonly publishableKey: string;
  private readonly authBaseUrl: string;
  private readonly storage: Storage;
  private readonly storageKey: string;
  private readonly fetchFn: FetchLike;
  private readonly listeners = new Set<(user: SyncHiveUser | null) => void>();
  private refreshPromise?: Promise<Session | null>;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(input: {
    publishableKey: string;
    parsed: ParsedPublishableKey;
    storage: Storage;
    fetchFn: FetchLike;
  }) {
    this.publishableKey = input.publishableKey;
    this.authBaseUrl = `${getApisHost(input.parsed)}/v1/hives/${encodeURIComponent(input.parsed.tenantHiveId)}/auth`;
    this.storage = input.storage;
    this.storageKey = `synchive.session:${input.publishableKey}`;
    this.fetchFn = input.fetchFn;
  }

  async init(): Promise<void> {
    const code = this.takeAuthCodeFromUrl();
    if (code === null) {
      // A failed refresh keeps the stored session; the next request retries it.
      await this.getFreshSession().catch(() => undefined);
      this.scheduleRefresh(this.readSession());
      return;
    }

    const response = await this.authRequest("/exchange", { code });
    this.setSession(
      sessionFromTokens(await this.readAuthResponse<Tokens>(response)),
    );
  }

  async signInWithPassword(credentials: PasswordCredentials): Promise<void> {
    const response = await this.authRequest("/sign-in/password", credentials);
    this.setSession(
      sessionFromTokens(await this.readAuthResponse<Tokens>(response)),
    );
  }

  async signUpWithPassword(credentials: PasswordCredentials): Promise<void> {
    const response = await this.authRequest("/sign-up/password", {
      ...credentials,
      options: { emailRedirectTo: getDefaultRedirectUrl() },
    });
    await this.readAuthResponse<void>(response);
  }

  async signOut(): Promise<void> {
    try {
      // Refresh an expired access token first so the server can revoke the session.
      const session = await this.getFreshSession();
      if (!session) return;
      const response = await this.authRequest(
        "/logout",
        undefined,
        session.accessToken,
      );
      if (response.status !== 401) await this.readAuthResponse<void>(response);
    } finally {
      this.setSession(null);
    }
  }

  async getUser(): Promise<SyncHiveUser | null> {
    return toUser(this.readSession());
  }

  async authorize(headers: Headers): Promise<void> {
    const session = await this.getFreshSession();
    if (!session || secondsUntilExpiry(session) <= 0) {
      throw new Error(
        "User is not authenticated. Call signInWithPassword() first.",
      );
    }
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    headers.set("x-PublishableKey", this.publishableKey);
  }

  onUserChange(listener: (user: SyncHiveUser | null) => void): () => void {
    this.listeners.add(listener);
    listener(toUser(this.readSession()));
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Removes the one-use sign-up confirmation code from the URL so it cannot leak or be replayed. */
  private takeAuthCodeFromUrl(): string | null {
    if (typeof window === "undefined") return null;
    const url = new URL(window.location.href);
    const code = url.searchParams.get(AUTH_CODE_PARAM);
    if (code === null) return null;
    url.searchParams.delete(AUTH_CODE_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
    return code;
  }

  private readSession(): Session | null {
    const stored = this.storage.getItem(this.storageKey);
    if (stored === null) return null;
    try {
      return JSON.parse(stored) as Session;
    } catch {
      // Treat an unreadable session as signed out so the app can recover by signing in.
      return null;
    }
  }

  private setSession(session: Session | null): Session | null {
    if (session) this.storage.setItem(this.storageKey, JSON.stringify(session));
    else this.storage.removeItem(this.storageKey);
    this.scheduleRefresh(session);
    const user = toUser(session);
    for (const listener of this.listeners) listener(user);
    return session;
  }

  /** Renews in the background shortly before expiry. */
  private scheduleRefresh(session: Session | null): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    if (typeof window === "undefined" || !session) return;
    const delaySeconds = secondsUntilExpiry(session) - REFRESH_MARGIN_SECONDS;
    this.refreshTimer = setTimeout(
      () => {
        this.getFreshSession().then(
          (fresh) => this.scheduleRefresh(fresh),
          () => undefined,
        );
      },
      Math.max(0, delaySeconds * 1000),
    );
  }

  private async getFreshSession(): Promise<Session | null> {
    const session = this.readSession();
    if (!session || !needsRefresh(session)) return session;
    return this.refreshSession();
  }

  private refreshSession(): Promise<Session | null> {
    // Refresh tokens are single use: share one refresh per client and lock across tabs.
    this.refreshPromise ??= this.withRefreshLock(async () => {
      const session = this.readSession();
      // Another tab may have refreshed while this one waited for the lock.
      if (!session || !needsRefresh(session)) return session;
      const response = await this.authRequest("/refresh", {
        refreshToken: session.refreshToken,
      });
      const tokens =
        response.status === 401
          ? null
          : await this.readAuthResponse<Tokens>(response);
      // A sign-in or sign-out while this refresh was in flight wins over its result.
      const current = this.readSession();
      if (current?.refreshToken !== session.refreshToken) return current;
      return this.setSession(tokens && sessionFromTokens(tokens));
    }).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async withRefreshLock<T>(action: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(this.storageKey, action);
    }
    return action();
  }

  private authRequest(
    path: string,
    body?: object,
    accessToken?: string,
  ): Promise<Response> {
    const headers = new Headers({ Accept: "application/json" });
    if (PUBLISHABLE_KEY_PATHS.has(path)) {
      headers.set("x-PublishableKey", this.publishableKey);
    }
    if (body) headers.set("Content-Type", "application/json");
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return this.fetchFn(`${this.authBaseUrl}${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async readAuthResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      let problem: AuthProblem = {};
      try {
        problem = JSON.parse(text);
      } catch {
        // Non-JSON error responses have no problem details.
      }
      const error: SyncHiveAuthError = Object.assign(
        new Error(
          problem.detail ||
            problem.title ||
            `Authentication failed (${response.status}).`,
        ),
        { status: response.status, code: problem.code },
      );
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}

const secondsUntilExpiry = (session: Session): number =>
  (session.expiresAt - Date.now()) / 1000;

const needsRefresh = (session: Session): boolean =>
  secondsUntilExpiry(session) <= REFRESH_MARGIN_SECONDS;

const sessionFromTokens = (tokens: Tokens): Session => ({
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  expiresAt: Date.now() + tokens.expiresIn * 1000,
  claims: decodeJwtClaims(tokens.accessToken),
});

const toUser = (session: Session | null): SyncHiveUser | null => {
  if (!session) return null;
  const { claims } = session;
  return {
    id: typeof claims.sub === "string" ? claims.sub : "",
    email: typeof claims.email === "string" ? claims.email : undefined,
    name: typeof claims.name === "string" ? claims.name : undefined,
    claims,
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    get expired() {
      return secondsUntilExpiry(session) <= 0;
    },
  };
};

const decodeJwtClaims = (token: string): Record<string, unknown> => {
  try {
    const bytes = Uint8Array.from(
      atob(normalizeBase64(token.split(".")[1] ?? "")),
      (char) => char.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
};
