export const normalizeBaseUrl = (baseUrl: string): string => {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
};

const tenantAppBasePathPattern = /^\/workspace\/[^/]+\/hive\/[^/]+/;

const getTenantAppBasePath = (pathname?: string): string => {
  if (pathname) {
    const match = pathname.match(tenantAppBasePathPattern);
    return match?.[0] ?? "";
  }

  if (typeof window === "undefined") return "";
  return getTenantAppBasePath(window.location.pathname);
};

export const applyTenantAppBasePathToApiBaseUrl = (baseUrl: string): string => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const tenantAppBasePath = getTenantAppBasePath();

  if (!normalizedBaseUrl || !tenantAppBasePath) {
    return normalizedBaseUrl;
  }

  const tenantApiPath = tenantAppBasePath.replace(/^\//, "");

  try {
    const url = new URL(
      normalizedBaseUrl,
      typeof window === "undefined" ? undefined : window.location.origin,
    );

    if (url.pathname.includes(`/${tenantApiPath}`)) {
      return normalizeBaseUrl(url.toString());
    }

    url.pathname = `${url.pathname.replace(/\/$/, "")}/${tenantApiPath}`;

    return normalizeBaseUrl(url.toString());
  } catch {
    return normalizedBaseUrl;
  }
};

export const getDefaultRedirectUrl = (): string => {
  if (typeof window === "undefined") {
    throw new Error("Browser redirects require a window environment.");
  }

  return new URL(
    getTenantAppBasePath() || "/",
    window.location.origin,
  ).toString();
};
