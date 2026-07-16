import { describe, expect, it } from "vitest";
import { CryptoKeyManager } from "./crypto-key-manager";
import { parseCryptoSecrets } from "./crypto-secrets";

describe("versioned crypto secrets", () => {
  it("parses version:value environment entries and preserves order", () => {
    expect(parseCryptoSecrets("2:new-secret:with-colon, 1:old-secret")).toEqual(
      [
        { version: 2, value: "new-secret:with-colon" },
        { version: 1, value: "old-secret" },
      ],
    );
  });

  it("allows gaps between secret versions", () => {
    expect(parseCryptoSecrets("3:current,1:original")).toEqual([
      { version: 3, value: "current" },
      { version: 1, value: "original" },
    ]);
  });

  it("rejects duplicate or malformed versions", () => {
    expect(() => parseCryptoSecrets("1:first,1:duplicate")).toThrow(
      /duplicate/i,
    );
    expect(() => parseCryptoSecrets("not-a-version:secret")).toThrow(
      /version/i,
    );
  });

  it("uses the first configured secret for new encryption", () => {
    const manager = new CryptoKeyManager({
      secrets: [
        { version: 7, value: "new-secret" },
        { version: 3, value: "old-secret" },
      ],
    });

    expect(manager.currentSecretVersion).toBe(7);
    expect(manager.configuredSecretVersions).toEqual([7, 3]);
  });
});
