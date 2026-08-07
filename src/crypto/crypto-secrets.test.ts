import { describe, expect, it } from "vitest";

import { InvalidCryptoSecretsError } from "../errors";
import { CryptoKeyManager } from "./crypto-key-manager";
import {
  parseCryptoSecretVersion,
  parseCryptoSecrets,
  parseCryptoSecretsConfig,
  validateCryptoSecrets,
} from "./crypto-secrets";

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

  it.each([undefined, "", "   "])(
    "treats current version %j as no configuration",
    (value) => {
      expect(parseCryptoSecretVersion(value)).toBeUndefined();
    },
  );

  it("parses the explicit current version", () => {
    expect(parseCryptoSecretVersion(" 7 ")).toBe(7);
  });

  it("rejects a non-string current version", () => {
    expect(() => parseCryptoSecretVersion(7 as unknown as string)).toThrow(
      InvalidCryptoSecretsError,
    );
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

  it.each([
    ["decimal version", "1.5"],
    ["negative version", "-1"],
    ["non-numeric version", "one"],
    ["overflowing version", "4294967296"],
  ])("rejects invalid current version: %s", (_case, value) => {
    expect(() => parseCryptoSecretVersion(value)).toThrow(
      InvalidCryptoSecretsError,
    );
  });

  it("requires a current version when environment secrets are configured", () => {
    expect(() =>
      parseCryptoSecretsConfig({
        secrets: "1:secret",
        currentVersion: undefined,
      }),
    ).toThrow(InvalidCryptoSecretsError);
  });

  it("treats absent environment configuration as optional", () => {
    expect(
      parseCryptoSecretsConfig({
        secrets: undefined,
        currentVersion: undefined,
      }),
    ).toBeNull();
  });

  it("does not disclose a malformed secret entry in its error", () => {
    const secret = "configured-secret-without-separator";
    let thrown: unknown;
    try {
      parseCryptoSecrets(secret);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InvalidCryptoSecretsError);
    expect((thrown as Error).message).not.toContain(secret);
  });

  it("rejects a non-string runtime value", () => {
    expect(() => parseCryptoSecrets(42 as unknown as string)).toThrowError(
      InvalidCryptoSecretsError,
    );
  });
});

describe("code-configured crypto secrets", () => {
  it("returns a copy and preserves secret values exactly", () => {
    const configured = [
      { version: 7, value: " current " },
      { version: 3, value: "old" },
    ];

    const config = { currentVersion: 7, secrets: configured };
    const validated = validateCryptoSecrets(config);

    expect(validated).toEqual(config);
    expect(validated).not.toBe(config);
    expect(validated.secrets).not.toBe(configured);
  });

  it.each([
    ["non-array configuration", null],
    ["legacy array configuration", [{ version: 1, value: "secret" }]],
    ["empty secrets", { currentVersion: 1, secrets: [] }],
    ["missing entry", { currentVersion: 1, secrets: [null] }],
    [
      "non-string value",
      { currentVersion: 1, secrets: [{ version: 1, value: 42 }] },
    ],
    [
      "non-numeric secret version",
      { currentVersion: 1, secrets: [{ version: "1", value: "secret" }] },
    ],
    [
      "blank value",
      { currentVersion: 1, secrets: [{ version: 1, value: "   " }] },
    ],
    [
      "negative secret version",
      { currentVersion: 1, secrets: [{ version: -1, value: "secret" }] },
    ],
    [
      "decimal secret version",
      { currentVersion: 1, secrets: [{ version: 1.5, value: "secret" }] },
    ],
    [
      "overflowing secret version",
      {
        currentVersion: 1,
        secrets: [{ version: 0x1_0000_0000, value: "secret" }],
      },
    ],
    [
      "duplicate version",
      {
        currentVersion: 1,
        secrets: [
          { version: 1, value: "first" },
          { version: 1, value: "second" },
        ],
      },
    ],
    [
      "unconfigured current version",
      { currentVersion: 2, secrets: [{ version: 1, value: "secret" }] },
    ],
    ["missing current version", { secrets: [{ version: 1, value: "secret" }] }],
    [
      "non-array secrets",
      { currentVersion: 1, secrets: { version: 1, value: "secret" } },
    ],
    [
      "non-numeric current version",
      { currentVersion: "1", secrets: [{ version: 1, value: "secret" }] },
    ],
  ])("rejects %s", (_case, config) => {
    expect(() =>
      validateCryptoSecrets(
        config as unknown as Parameters<typeof validateCryptoSecrets>[0],
      ),
    ).toThrow(InvalidCryptoSecretsError);
  });

  it("uses the explicit current version regardless of secret order", () => {
    const manager = new CryptoKeyManager({
      currentVersion: 7,
      secrets: [
        { version: 3, value: "old" },
        { version: 7, value: "current" },
      ],
    });

    expect(manager.currentSecretVersion).toBe(7);
    expect(manager.configuredSecretVersions).toEqual([3, 7]);
  });
});
