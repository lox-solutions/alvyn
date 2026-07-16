import { describe, expect, it } from "vitest";

import { InvalidCryptoSecretsError } from "../errors";
import { CryptoKeyManager } from "./crypto-key-manager";
import { parseCryptoSecrets, validateCryptoSecrets } from "./crypto-secrets";

describe("environment crypto secrets", () => {
  it.each([undefined, "", "   "])(
    "treats %j as no environment configuration",
    (value) => {
      expect(parseCryptoSecrets(value)).toEqual([]);
    },
  );

  it("preserves order, permits version gaps, and keeps colons in values", () => {
    expect(parseCryptoSecrets(" 7:new:secret , 3:old-secret ")).toEqual([
      { version: 7, value: "new:secret" },
      { version: 3, value: "old-secret" },
    ]);
  });

  it("accepts both version boundaries", () => {
    expect(parseCryptoSecrets("0:first,4294967295:last")).toEqual([
      { version: 0, value: "first" },
      { version: 0xffffffff, value: "last" },
    ]);
  });

  it.each([
    ["missing separator", "1"],
    ["missing version", ":secret"],
    ["empty value", "1:"],
    ["trailing comma", "1:secret,"],
    ["negative version", "-1:secret"],
    ["decimal version", "1.5:secret"],
    ["non-numeric version", "one:secret"],
    ["overflowing version", "4294967296:secret"],
    ["unsafe integer version", "9007199254740992:secret"],
    ["duplicate version", "1:first,1:second"],
  ])("rejects %s", (_case, value) => {
    expect(() => parseCryptoSecrets(value)).toThrow(InvalidCryptoSecretsError);
  });

  it("rejects a non-string runtime value", () => {
    expect(() => parseCryptoSecrets(42 as unknown as string)).toThrowError(
      InvalidCryptoSecretsError,
    );
  });
});

describe("code-configured crypto secrets", () => {
  it("returns an ordered copy and preserves secret values exactly", () => {
    const configured = [
      { version: 7, value: " current " },
      { version: 3, value: "old" },
    ];

    const validated = validateCryptoSecrets(configured);

    expect(validated).toEqual(configured);
    expect(validated).not.toBe(configured);
  });

  it.each([
    ["non-array configuration", null],
    ["empty array", []],
    ["missing entry", [null]],
    ["non-string value", [{ version: 1, value: 42 }]],
    ["non-numeric version", [{ version: "1", value: "secret" }]],
    ["blank value", [{ version: 1, value: "   " }]],
    ["negative version", [{ version: -1, value: "secret" }]],
    ["decimal version", [{ version: 1.5, value: "secret" }]],
    ["overflowing version", [{ version: 0x1_0000_0000, value: "secret" }]],
    [
      "duplicate version",
      [
        { version: 1, value: "first" },
        { version: 1, value: "second" },
      ],
    ],
  ])("rejects %s", (_case, secrets) => {
    expect(() =>
      validateCryptoSecrets(
        secrets as unknown as Parameters<typeof validateCryptoSecrets>[0],
      ),
    ).toThrow(InvalidCryptoSecretsError);
  });

  it("uses the first entry for encryption without requiring consecutive versions", () => {
    const manager = new CryptoKeyManager({
      secrets: [
        { version: 7, value: "current" },
        { version: 3, value: "old" },
      ],
    });

    expect(manager.currentSecretVersion).toBe(7);
    expect(manager.configuredSecretVersions).toEqual([7, 3]);
  });
});
