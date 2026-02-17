import type { UserManagerSettings } from "oidc-client-ts";

export type ListParams = {
  top?: number;
  skip?: number;
  filter?: string;
  orderby?: string;
};

export type ShapeRecord = Record<string, unknown>;

export type Pagination = {
  totalItems?: number;
  totalPages?: number;
  pageNumber?: number;
  pageSize?: number;
};

export type ListResult<T = ShapeRecord> = {
  shapes: T[];
  pagination: Pagination;
};

export type FetchLike = typeof fetch;

export type SynchiveClientOptions = {
  publishableKey?: string;
  apiBaseUrl?: string;
  auth?: UserManagerSettings;
  authOverrides?: Partial<UserManagerSettings>;
  storage?: Storage;
  fetch?: FetchLike;
};
