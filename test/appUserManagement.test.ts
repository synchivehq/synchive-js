import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncHiveManagementError, type SyncHiveClient } from "../src";
import {
  API,
  AUTH,
  createV2Client,
  stubWindow,
  tokens,
  v2Key,
  type Call,
} from "./helpers";

const user = { hiveId: "USER1", isEnabled: true, roles: [] };
const users = {
  value: [user],
  count: 3,
  nextLink: `${API}/auth-users?top=1&skip=1`,
};
const permissions = {
  appUserManagementPermission: "EDIT",
  roles: [{ id: 7, name: "Manager" }],
  policies: [{ id: 9, name: "Read" }],
};
const assignment = { id: 7, name: "Manager" };
const roles = {
  value: [{
    ...assignment,
    description: "App managers",
    scopeId: 2,
    isDefault: false,
    appUserManagementPermission: "EDIT",
    isProtected: true,
  }],
  count: 1,
};
const accountId = "USER/a b?c#";
const encodedAccountId = "USER%2Fa%20b%3Fc%23";

type Operation = {
  name: string;
  run: (client: SyncHiveClient) => Promise<unknown>;
  url: string;
  method: string;
  result: unknown;
  body?: unknown;
  contentType?: string;
};

const operations: Operation[] = [
  {
    name: "getPermissions",
    run: (client) => client.getPermissions(),
    url: `${AUTH}/me`,
    method: "GET",
    result: permissions,
  },
  {
    name: "listAppUsers",
    run: (client) => client.listAppUsers(),
    url: `${API}/auth-users`,
    method: "GET",
    result: users,
  },
  {
    name: "getAppUser",
    run: (client) => client.getAppUser(accountId),
    url: `${API}/auth-users/${encodedAccountId}`,
    method: "GET",
    result: user,
  },
  {
    name: "updateAppUser",
    run: (client) => client.updateAppUser(accountId, { isEnabled: false }),
    url: `${API}/auth-users/${encodedAccountId}`,
    method: "PATCH",
    result: { ...user, isEnabled: false },
    body: { isEnabled: false },
    contentType: "application/merge-patch+json",
  },
  {
    name: "deleteAppUser",
    run: (client) => client.deleteAppUser(accountId),
    url: `${API}/auth-users/${encodedAccountId}`,
    method: "DELETE",
    result: undefined,
  },
  {
    name: "assignAppUserRole",
    run: (client) => client.assignAppUserRole(accountId, 7),
    url: `${API}/auth-users/${encodedAccountId}/roles/7`,
    method: "PUT",
    result: assignment,
    body: {},
    contentType: "application/json",
  },
  {
    name: "removeAppUserRole",
    run: (client) => client.removeAppUserRole(accountId, 7),
    url: `${API}/auth-users/${encodedAccountId}/roles/7`,
    method: "DELETE",
    result: undefined,
  },
  {
    name: "listAppRoles",
    run: (client) => client.listAppRoles(),
    url: `${API}/auth-roles`,
    method: "GET",
    result: roles,
  },
  {
    name: "listRoleMembers",
    run: (client) => client.listRoleMembers(7),
    url: `${API}/auth-roles/7/members`,
    method: "GET",
    result: users,
  },
];

const signedInClient = async (
  routes: Record<string, (call: Call) => Response | Promise<Response>> = {},
) => {
  const session = tokens();
  const context = createV2Client({
    "/sign-in/password": () => Response.json(session),
    ...routes,
  });
  await context.client.signInWithPassword({ email: "a@b.c", password: "pw" });
  return { ...context, session };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(["/", "/workspace/acme/hive/catalog/users"])(
  "App User management from browser path %s",
  (path) => {
    it.each(operations)("$name sends the correct request and returns its response", async (operation) => {
      vi.useFakeTimers();
      stubWindow(`https://app.test${path}`);
      const { client, calls, fetch, session } = await signedInClient({
        [operation.url]: () => operation.result === undefined
          ? new Response(null, { status: 204 })
          : Response.json(operation.result),
      });

      await expect(operation.run(client)).resolves.toEqual(operation.result);
      expect(calls).toHaveLength(2);
      const request = calls[1]!;
      expect(request.url).toBe(operation.url);
      expect(request.method).toBe(operation.method);
      expect(request.body).toEqual(operation.body);
      expect(request.headers.get("Content-Type")).toBe(operation.contentType ?? null);
      expect(request.headers.get("Accept")).toBe("application/json");
      expect(request.headers.get("Authorization")).toBe(`Bearer ${session.accessToken}`);
      expect(request.headers.get("x-PublishableKey")).toBe(v2Key());
      expect(vi.mocked(fetch).mock.calls[1]?.[1]?.cache).toBe("no-store");
    });
  },
);

describe("management pagination", () => {
  const lists = [
    {
      name: "listAppUsers",
      path: "/auth-users",
      property: "email",
      item: (n: number) => ({ ...user, hiveId: `USER${n}` }),
      run: (client: SyncHiveClient, params?: Parameters<SyncHiveClient["listAppUsers"]>[0]) => client.listAppUsers(params),
    },
    {
      name: "listRoleMembers",
      path: "/auth-roles/7/members",
      property: "email",
      item: (n: number) => ({ ...user, hiveId: `USER${n}` }),
      run: (client: SyncHiveClient, params?: Parameters<SyncHiveClient["listRoleMembers"]>[1]) => client.listRoleMembers(7, params),
    },
    {
      name: "listAppRoles",
      path: "/auth-roles",
      property: "name",
      item: (n: number) => ({ ...roles.value[0]!, id: n }),
      run: (client: SyncHiveClient, params?: Parameters<SyncHiveClient["listAppRoles"]>[0]) => client.listAppRoles(params),
    },
  ];

  describe.each(lists)("$name", (list) => {
    it.each([
      { label: "omitted parameters", params: undefined, query: "" },
      { label: "undefined values", params: { top: undefined, skip: undefined, filter: undefined }, query: "" },
      { label: "an explicit zero limit for server validation", params: { top: 0, skip: undefined }, query: "?top=0" },
      { label: "zero offset", params: { top: 1, skip: 0 }, query: "?top=1&skip=0" },
      { label: "an offset that is not a page-size multiple", params: { top: 10, skip: 3 }, query: "?top=10&skip=3" },
      { label: "maximum page size", params: { top: 1000, skip: 2000 }, query: "?top=1000&skip=2000" },
      { label: "a filter with URL-sensitive text", params: { filter: `contains(${list.property},'o''brien+tag&%_é@example.com')`, skip: 0, top: undefined }, query: `?filter=contains%28${list.property}%2C%27o%27%27brien%2Btag%26%25_%C3%A9%40example.com%27%29&skip=0` },
    ])("serializes $label", async ({ params, query }) => {
      const { client, calls } = await signedInClient();
      await list.run(client, params);
      expect(calls.at(-1)?.url).toBe(`${API}${list.path}${query}`);
    });

    it("keeps top, filter and the exact next offset across pages", async () => {
      const filter = `contains(${list.property},'example.com')`;
      const { client, calls } = await signedInClient({
        [`?top=2&skip=0&filter=contains%28${list.property}%2C%27example.com%27%29`]: () => Response.json({
          value: [list.item(1), list.item(2)],
          count: 3,
          nextLink: `${API}${list.path}?top=2&skip=2&filter=contains%28${list.property}%2C%27example.com%27%29`,
        }),
        [`?top=2&skip=2&filter=contains%28${list.property}%2C%27example.com%27%29`]: () => Response.json({
          value: [list.item(3)],
          count: 3,
        }),
      });
      const first = await list.run(client, { top: 2, skip: 0, filter });
      expect(first.count).toBe(3);
      expect(first.nextLink).toBe(`${API}${list.path}?top=2&skip=2&filter=contains%28${list.property}%2C%27example.com%27%29`);
      const next = await list.run(client, { top: 2, skip: first.value.length, filter });
      expect(next).toEqual({ value: [list.item(3)], count: 3 });
      expect(next.nextLink).toBeUndefined();
      expect(calls.at(-1)?.url).toBe(first.nextLink);
    });
  });
});

describe("management errors", () => {
  it.each(operations)("$name throws the exported error class for HTTP failures", async (operation) => {
    const { client } = await signedInClient({
      [operation.url]: () => Response.json({
        title: "Insufficient Permissions",
        detail: "You do not have permission to perform this operation.",
        code: "management_forbidden",
        status: 500,
      }, { status: 403 }),
    });
    const error = await operation.run(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SyncHiveManagementError);
    expect(error).toMatchObject({
      name: "SyncHiveManagementError",
      message: "You do not have permission to perform this operation.",
      status: 403,
      title: "Insufficient Permissions",
      detail: "You do not have permission to perform this operation.",
      code: "management_forbidden",
    });
  });

  it.each([
    { label: "title without detail", body: '{"title":"Forbidden"}', message: "Forbidden", title: "Forbidden" },
    { label: "title with empty detail", body: '{"title":"Forbidden","detail":""}', message: "Forbidden", title: "Forbidden", detail: "" },
    { label: "plain text", body: "Upstream unavailable", message: "Upstream unavailable" },
    { label: "JSON without problem fields", body: '{"reason":"Blocked"}', message: '{"reason":"Blocked"}' },
    { label: "an empty response", body: "", message: "App User management request failed (403)." },
    { label: "null JSON", body: "null", message: "null" },
    { label: "a JSON array", body: "[]", message: "[]" },
    { label: "a JSON string", body: '"Forbidden"', message: '"Forbidden"' },
    { label: "non-string problem fields", body: '{"title":4,"detail":false,"code":[]}', message: '{"title":4,"detail":false,"code":[]}' },
  ])("preserves status and falls back for $label", async ({ body, message, title, detail }) => {
    const { client } = await signedInClient({
      "/auth-users": () => new Response(body, { status: 403 }),
    });
    await expect(client.listAppUsers()).rejects.toMatchObject({
      name: "SyncHiveManagementError",
      message,
      status: 403,
      title,
      detail,
      code: undefined,
    });
  });

  it.each(operations)("$name rejects before fetching when signed out", async (operation) => {
    const { client, calls } = createV2Client({});
    const error = await operation.run(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SyncHiveManagementError);
    expect(error).toHaveProperty("message", "User is not authenticated. Call signInWithPassword() first.");
    expect(calls).toEqual([]);
  });

  it("exposes server validation failures for invalid paging parameters", async () => {
    const { client, calls } = await signedInClient({
      "?top=0&skip=-1": () => Response.json({
        title: "Invalid Request",
        detail: "top must be between 1 and 1000.",
      }, { status: 400 }),
    });
    await expect(client.listAppUsers({ top: 0, skip: -1 })).rejects.toMatchObject({
      status: 400,
      title: "Invalid Request",
      detail: "top must be between 1 and 1000.",
    });
    expect(calls.at(-1)?.url).toBe(`${API}/auth-users?top=0&skip=-1`);
  });

  it("preserves network failures", async () => {
    const failure = new TypeError("Failed to fetch");
    const { client } = await signedInClient({
      "/auth-users": () => { throw failure; },
    });
    await expect(client.listAppUsers()).rejects.toBe(failure);
  });

  it("preserves ordinary data request error behavior", async () => {
    const { client } = await signedInClient({
      "/shape/Product/P1": () => new Response("Upstream unavailable", { status: 503 }),
    });
    const error = await client.get("Product", "P1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SyncHiveManagementError);
    expect(error).toHaveProperty("message", "Request failed (503): Upstream unavailable");
  });
});

describe("getCurrentUser", () => {
  it("returns null when signed out without fetching", async () => {
    const { client, calls } = createV2Client({});
    await expect(client.getCurrentUser()).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("returns the signed-in session without fetching", async () => {
    const { client, calls } = await signedInClient();
    const current = await client.getCurrentUser();
    expect(current?.id).toBe("user-1");
    expect(calls).toHaveLength(1);
  });
});
