import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  decryptFields,
  encryptFields,
  type EncryptedFieldEntry,
  type EncryptResult,
  type FieldEncryptionContext,
} from "./field-encryptor";

const KEY = randomBytes(32);
const CONTEXT: FieldEncryptionContext = {
  eventId: "User-1/1",
  cryptoKeyId: "user:1",
};

function encrypt(
  data: Record<string, unknown>,
  fields: string[],
): EncryptResult {
  return encryptFields({
    data,
    fields,
    aesKey: KEY,
    keyVersion: 7,
    context: CONTEXT,
  });
}

function decrypt(
  result: EncryptResult,
  options: {
    key?: Buffer;
    context?: FieldEncryptionContext;
    encryptedData?: Record<string, EncryptedFieldEntry>;
  } = {},
): Record<string, unknown> {
  return decryptFields({
    cleanData: result.cleanData,
    encryptedData: options.encryptedData ?? result.encryptedData,
    aesKey: options.key ?? KEY,
    context: options.context ?? CONTEXT,
  });
}

function flipBase64Bit(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

describe("field encryption", () => {
  describe("round trips", () => {
    it("removes encrypted fields from clean data and restores every JSON value", () => {
      const data = {
        name: "Alice",
        count: 42,
        enabled: true,
        nullable: null,
        details: { roles: ["admin", "author"] },
        public: "visible",
      };

      const encrypted = encrypt(data, [
        "name",
        "count",
        "enabled",
        "nullable",
        "details",
      ]);

      expect(encrypted.cleanData).toEqual({ public: "visible" });
      expect(decrypt(encrypted)).toEqual(data);
    });

    it("supports nested dot paths without removing public siblings", () => {
      const data = {
        address: { street: "Main Street", city: "Berlin" },
        active: true,
      };

      const encrypted = encrypt(data, ["address.street"]);

      expect(encrypted.cleanData).toEqual({
        address: { city: "Berlin" },
        active: true,
      });
      expect(decrypt(encrypted)).toEqual(data);
    });

    it("skips fields that are absent from this event", () => {
      const encrypted = encrypt({ name: "Alice" }, [
        "name",
        "missing",
        "nested.missing",
      ]);

      expect(Object.keys(encrypted.encryptedData)).toEqual(["name"]);
    });

    it("returns a clone when no fields are selected", () => {
      const data = { name: "Alice" };
      const encrypted = encrypt(data, []);

      expect(encrypted).toEqual({ cleanData: data, encryptedData: {} });
      expect(encrypted.cleanData).not.toBe(data);
    });

    it("does not mutate encryption or decryption inputs", () => {
      const data = { name: "Alice", public: "visible" };
      const encrypted = encrypt(data, ["name"]);
      const cleanBeforeDecryption = structuredClone(encrypted.cleanData);

      decrypt(encrypted);

      expect(data).toEqual({ name: "Alice", public: "visible" });
      expect(encrypted.cleanData).toEqual(cleanBeforeDecryption);
    });

    it.each([
      ["a missing parent", {}],
      ["a primitive parent", { profile: "public" }],
      ["a null parent", { profile: null }],
    ])("restores a nested field over %s in clean data", (_case, cleanData) => {
      const encrypted = encrypt({ profile: { secret: "value" } }, [
        "profile.secret",
      ]);

      const restored = decrypt({ ...encrypted, cleanData });

      expect(restored).toEqual({ profile: { secret: "value" } });
    });

    it("uses a distinct random IV for each field", () => {
      const { encryptedData } = encrypt({ first: "same", second: "same" }, [
        "first",
        "second",
      ]);

      expect(encryptedData.first.iv).not.toBe(encryptedData.second.iv);
    });
  });

  describe("authenticated context", () => {
    it("rejects ciphertext moved to another field", () => {
      const encrypted = encrypt({ name: "Alice", email: "alice@example.com" }, [
        "name",
        "email",
      ]);

      expect(() =>
        decrypt(encrypted, {
          encryptedData: {
            name: encrypted.encryptedData.email,
            email: encrypted.encryptedData.name,
          },
        }),
      ).toThrow();
    });

    it.each([
      ["event identity", { ...CONTEXT, eventId: "User-1/2" }],
      ["crypto key identity", { ...CONTEXT, cryptoKeyId: "user:2" }],
    ])("rejects a changed %s", (_label, context) => {
      const encrypted = encrypt({ secret: "classified" }, ["secret"]);

      expect(() => decrypt(encrypted, { context })).toThrow();
    });

    it("rejects a changed key version", () => {
      const encrypted = encrypt({ secret: "classified" }, ["secret"]);
      const changedVersion = {
        ...encrypted.encryptedData.secret,
        version: 8,
      };

      expect(() =>
        decrypt(encrypted, {
          encryptedData: { secret: changedVersion },
        }),
      ).toThrow();
    });
  });

  describe("tamper resistance", () => {
    it("rejects the wrong AES key", () => {
      const encrypted = encrypt({ secret: "classified" }, ["secret"]);

      expect(() => decrypt(encrypted, { key: randomBytes(32) })).toThrow();
    });

    it.each(["ciphertext", "iv", "authTag"] as const)(
      "rejects a modified %s",
      (property) => {
        const encrypted = encrypt({ secret: "classified" }, ["secret"]);
        const entry = encrypted.encryptedData.secret;
        const tampered = {
          ...entry,
          [property]: flipBase64Bit(entry[property]),
        };

        expect(() =>
          decrypt(encrypted, { encryptedData: { secret: tampered } }),
        ).toThrow();
      },
    );
  });

  describe("malformed data", () => {
    it.each(["", ".secret", "secret.", "__proto__", "a.constructor.b"])(
      "rejects unsafe field path %j",
      (field) => {
        expect(() => encrypt({ secret: "value" }, [field])).toThrow(
          "Invalid encrypted field path",
        );
      },
    );

    it.each([
      ["duplicate paths", ["profile", "profile"]],
      ["parent before child", ["profile", "profile.secret"]],
      ["child before parent", ["profile.secret", "profile"]],
    ])("rejects %s", (_case, fields) => {
      expect(() => encrypt({ profile: { secret: "value" } }, fields)).toThrow(
        "overlaps another path",
      );
    });

    it("does not treat inherited properties as event fields", () => {
      const encrypted = encrypt({ name: "Alice" }, ["toString"]);

      expect(encrypted.encryptedData).toEqual({});
    });

    it.each([null, "public"])(
      "skips a nested field below a non-object parent (%j)",
      (profile) => {
        const encrypted = encrypt({ profile }, ["profile.secret"]);

        expect(encrypted.encryptedData).toEqual({});
      },
    );

    it.each([undefined, -1, 1.5, 0x1_0000_0000])(
      "rejects invalid key version %s",
      (version) => {
        expect(() =>
          encryptFields({
            data: { secret: "value" },
            fields: ["secret"],
            aesKey: KEY,
            keyVersion: version!,
            context: CONTEXT,
          }),
        ).toThrow("Invalid encrypted field version");
      },
    );

    it("rejects a missing encrypted field entry", () => {
      expect(() =>
        decryptFields({
          cleanData: {},
          encryptedData: { secret: null as unknown as EncryptedFieldEntry },
          aesKey: KEY,
          context: CONTEXT,
        }),
      ).toThrow("Invalid encrypted field entry");
    });

    it("rejects a non-string encoded component", () => {
      const encrypted = encrypt({ secret: "classified" }, ["secret"]);
      const malformed = {
        ...encrypted.encryptedData.secret,
        ciphertext: 42 as unknown as string,
      };

      expect(() =>
        decrypt(encrypted, { encryptedData: { secret: malformed } }),
      ).toThrow("Invalid encrypted field ciphertext");
    });

    it.each([
      {
        property: "ciphertext",
        value: "not base64!",
        errorLabel: "ciphertext",
      },
      {
        property: "iv",
        value: Buffer.alloc(11).toString("base64"),
        errorLabel: "initialization vector",
      },
      {
        property: "authTag",
        value: Buffer.alloc(15).toString("base64"),
        errorLabel: "authentication tag",
      },
    ] as const)(
      "rejects an invalid $property",
      ({ property, value, errorLabel }) => {
        const encrypted = encrypt({ secret: "classified" }, ["secret"]);
        const malformed = {
          ...encrypted.encryptedData.secret,
          [property]: value,
        };

        expect(() =>
          decrypt(encrypted, { encryptedData: { secret: malformed } }),
        ).toThrow(`Invalid encrypted field ${errorLabel}`);
      },
    );

    it("rejects an unsafe path read from encrypted data", () => {
      const encrypted = encrypt({ secret: "classified" }, ["secret"]);

      expect(() =>
        decrypt(encrypted, {
          encryptedData: { constructor: encrypted.encryptedData.secret },
        }),
      ).toThrow("Invalid encrypted field path");
    });
  });
});
