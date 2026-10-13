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

export type UploadFileRequest = {
  fileName: string;
  contentType: string;
  fileSize: number;
  fileHiveId?: string;
};

export type UploadFileResult = {
  fileHiveId: string;
  uploadUrl: string;
  uploadToken: string;
  expiresOn: string;
};

export type DownloadFileResult = {
  fileHiveId: string;
  fileName: string;
  fileSize: number;
  contentType?: string;
  downloadUrl: string;
  expiresOn: string;
};

export type DownloadedFile = {
  fileHiveId: string;
  fileName: string;
  fileSize: number;
  contentType?: string;
  blob: Blob;
};

export type SyncHiveUser = {
  /** The user's ID, from the access token's `sub` claim. */
  id: string;
  email?: string;
  name?: string;
  /** Every claim in the access token. */
  claims: Record<string, unknown>;
  accessToken: string;
  /** Access token expiry, in milliseconds since the Unix epoch. */
  expiresAt: number;
  readonly expired: boolean;
};

/** Stable reasons the SyncHive auth service gives for failures. */
export type SyncHiveAuthErrorCode =
  | "email_already_in_use"
  | "invalid_redirect"
  | "invalid_confirmation"
  | "superseded_verification_link"
  | "registration_password_required"
  | "incorrect_password"
  | "invalid_password"
  | "invalid_email"
  | "account_not_found"
  | "account_email_not_verified"
  | "email_request_rate_limited"
  | "invalid_password_reset_link"
  | "superseded_password_reset_link"
  | "used_password_reset_link"
  | "expired_password_reset_link"
  // Keeps codes the server adds later assignable without losing autocomplete.
  | (string & {});

/** Thrown by the auth methods. */
export type SyncHiveAuthError = Error & {
  status: number;
  code?: SyncHiveAuthErrorCode;
};

export type AuthState = {
  user: SyncHiveUser | null;
  isAuthenticated: boolean;
};

export type AuthStateChangeTrigger = "authenticated" | "unauthenticated";

export type AuthStateChangeListener = (
  state: AuthState,
  trigger: AuthStateChangeTrigger,
) => void;

export type AuthStateChangeUnsubscribe = () => void;

export type FetchLike = typeof fetch;

export type SynchiveClientOptions = {
  publishableKey: string;
  storage?: Storage;
  fetch?: FetchLike;
};
