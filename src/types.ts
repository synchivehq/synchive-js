import type { UserManagerSettings } from "oidc-client-ts";

export type ListParams = {
  top?: number;
  skip?: number;
  filter?: string;
};

export type ListResult<T> = T[] | { value: T[]; [key: string]: unknown };

export type FetchLike = typeof fetch;

export type SynchiveClientOptions = {
  publishableKey?: string;
  apiBaseUrl?: string;
  auth?: UserManagerSettings;
  authOverrides?: Partial<UserManagerSettings>;
  storage?: Storage;
  fetch?: FetchLike;
  buildListUrl?: (shape: string, params: ListParams | undefined, baseUrl: string) => string;
  buildGetUrl?: (shape: string, hiveId: string, baseUrl: string) => string;
};
