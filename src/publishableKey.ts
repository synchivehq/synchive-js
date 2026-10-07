export type ParsedPublishableKey = {
  environment: string;
  region: string;
  tenantHiveId: string;
  encryptedKey: string;
};

const PUBLISHABLE_PREFIX = "sh_publishable_";
const PUBLISHABLE_V2_PREFIX = "sh_publishable_v2_";

export const getApisHost = (parsed: ParsedPublishableKey): string => {
  return parsed.environment === "prod"
    ? `https://${parsed.region}-apis.synchive.com`
    : `https://${parsed.region}-apis.${parsed.environment}.synchive.com`;
};

export const getApiBaseUrl = (parsed: ParsedPublishableKey): string => {
  return `${getApisHost(parsed)}/v2/hives/${encodeURIComponent(parsed.tenantHiveId)}`;
};

/** Decodes a `{prefix}{region}_{base64(env::tenantHiveId::encryptedKey)}` V2 key. */
export const decodePublishableKey = (
  publishableKey: string,
): ParsedPublishableKey => {
  if (!publishableKey.startsWith(PUBLISHABLE_V2_PREFIX)) {
    if (publishableKey.startsWith(PUBLISHABLE_PREFIX)) {
      throw new Error(
        "Legacy and V1 publishable keys aren't supported by @synchive/synchive-js 2.x. Use a V2 key (sh_publishable_v2_...), or stay on 1.x.",
      );
    }
    throw new Error("publishableKey is invalid or missing required prefix.");
  }

  const keyContents = publishableKey.slice(PUBLISHABLE_V2_PREFIX.length);
  const regionSeparatorIndex = keyContents.indexOf("_");
  const hasRegion = regionSeparatorIndex > 0;
  const hasPayload = regionSeparatorIndex < keyContents.length - 1;

  if (!hasRegion || !hasPayload) {
    throw new Error("publishableKey is missing region or payload.");
  }

  const region = keyContents.slice(0, regionSeparatorIndex);
  const encoded = keyContents.slice(regionSeparatorIndex + 1);
  let decoded: string;
  try {
    decoded = atob(normalizeBase64(encoded));
  } catch {
    throw new Error("publishableKey is not valid base64.");
  }

  const parts = decoded.split("::");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("publishableKey payload is invalid.");
  }

  return {
    environment: parts[0],
    region,
    tenantHiveId: parts[1],
    encryptedKey: parts[2],
  };
};

export const normalizeBase64 = (value: string): string => {
  // Accept base64url and legacy variants seen in externally supplied keys.
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
