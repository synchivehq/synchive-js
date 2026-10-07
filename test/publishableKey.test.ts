import { describe, expect, it } from "vitest";
import { decodePublishableKey, getApiBaseUrl } from "../src/publishableKey";
import { base64Url, legacyKey, v1Key, v2Key } from "./helpers";

describe("decodePublishableKey", () => {
  it("decodes V2 keys and points production keys at the regional API", () => {
    const parsed = decodePublishableKey(
      v2Key("prod::HIVE1::secret", "us-west-2"),
    );

    expect(parsed).toEqual({
      environment: "prod",
      region: "us-west-2",
      tenantHiveId: "HIVE1",
      encryptedKey: "secret",
    });
    expect(getApiBaseUrl(parsed)).toBe(
      "https://us-west-2-apis.synchive.com/v2/hives/HIVE1",
    );
  });

  it("includes the environment in non-production API URLs", () => {
    const parsed = decodePublishableKey(
      v2Key("dev::HIVE1::secret", "us-west-2"),
    );

    expect(getApiBaseUrl(parsed)).toBe(
      "https://us-west-2-apis.dev.synchive.com/v2/hives/HIVE1",
    );
  });

  it.each([
    ["legacy", legacyKey()],
    ["V1", v1Key()],
  ])("rejects %s keys with an upgrade message", (_name, key) => {
    expect(() => decodePublishableKey(key)).toThrow(
      "Legacy and V1 publishable keys aren't supported by @synchive/synchive-js 2.x. Use a V2 key (sh_publishable_v2_...), or stay on 1.x.",
    );
  });

  it("rejects keys without a known prefix", () => {
    expect(() => decodePublishableKey("pk_live_123")).toThrow(
      "publishableKey is invalid or missing required prefix.",
    );
  });

  it("rejects keys missing a region", () => {
    expect(() =>
      decodePublishableKey(`sh_publishable_v2__${base64Url("a::b::c")}`),
    ).toThrow("publishableKey is missing region or payload.");
  });

  it("rejects keys with the wrong number of payload parts", () => {
    expect(() => decodePublishableKey(v2Key("dev::HIVE1"))).toThrow(
      "publishableKey payload is invalid.",
    );
  });
});
