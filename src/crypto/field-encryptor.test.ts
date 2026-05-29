import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptFields, decryptFields } from "./field-encryptor";

function makeKey(): Buffer {
  return randomBytes(32);
}

describe("field-encryptor", () => {
  describe("encryptFields / decryptFields round-trip", () => {
    it("encrypts and decrypts top-level string fields", () => {
      const key = makeKey();
      const data = { name: "Alice", email: "alice@example.com", age: 30 };

      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: ["name", "email"],
        aesKey: key,
      });

      expect(cleanData.name).toBeUndefined();
      expect(cleanData.email).toBeUndefined();
      expect(cleanData.age).toBe(30);
      expect(encryptedData.name).toBeDefined();
      expect(encryptedData.name.ciphertext).toBeTruthy();
      expect(encryptedData.name.iv).toBeTruthy();
      expect(encryptedData.name.authTag).toBeTruthy();

      const restored = decryptFields({ cleanData, encryptedData, aesKey: key });
      expect(restored.name).toBe("Alice");
      expect(restored.email).toBe("alice@example.com");
      expect(restored.age).toBe(30);
    });

    it("encrypts and decrypts nested fields via dot-path", () => {
      const key = makeKey();
      const data = {
        address: { street: "123 Main", city: "Berlin" },
        active: true,
      };

      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: ["address.street", "address.city"],
        aesKey: key,
      });

      expect(
        (cleanData.address as Record<string, unknown>).street,
      ).toBeUndefined();
      expect(
        (cleanData.address as Record<string, unknown>).city,
      ).toBeUndefined();
      expect(cleanData.active).toBe(true);

      const restored = decryptFields({ cleanData, encryptedData, aesKey: key });
      expect((restored.address as Record<string, unknown>).street).toBe(
        "123 Main",
      );
      expect((restored.address as Record<string, unknown>).city).toBe("Berlin");
    });

    it("handles non-string values (numbers, objects, arrays)", () => {
      const key = makeKey();
      const data = {
        secret: { nested: [1, 2, 3] },
        count: 42,
        public: "visible",
      };

      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: ["secret", "count"],
        aesKey: key,
      });

      expect(cleanData.secret).toBeUndefined();
      expect(cleanData.count).toBeUndefined();

      const restored = decryptFields({ cleanData, encryptedData, aesKey: key });
      expect(restored.secret).toEqual({ nested: [1, 2, 3] });
      expect(restored.count).toBe(42);
    });
  });

  describe("edge cases", () => {
    it("skips undefined fields without error", () => {
      const key = makeKey();
      const data = { name: "Alice" };

      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: ["name", "nonexistent", "deep.path.missing"],
        aesKey: key,
      });

      expect(cleanData.name).toBeUndefined();
      expect(Object.keys(encryptedData)).toEqual(["name"]);
    });

    it("returns original data when fields array is empty", () => {
      const key = makeKey();
      const data = { name: "Alice", age: 30 };

      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: [],
        aesKey: key,
      });

      expect(cleanData).toEqual(data);
      expect(Object.keys(encryptedData)).toHaveLength(0);
    });

    it("does not mutate the original data object", () => {
      const key = makeKey();
      const original = { name: "Alice", age: 30 };
      const copy = { ...original };

      encryptFields({ data: original, fields: ["name"], aesKey: key });

      expect(original).toEqual(copy);
    });

    it("decryptFields does not mutate cleanData input", () => {
      const key = makeKey();
      const data = { name: "Alice", age: 30 };
      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: ["name"],
        aesKey: key,
      });
      const cleanCopy = JSON.parse(
        JSON.stringify(cleanData),
      ) as typeof cleanData;

      decryptFields({ cleanData, encryptedData, aesKey: key });

      expect(cleanData).toEqual(cleanCopy);
    });

    it("rejects prototype pollution paths silently", () => {
      const key = makeKey();
      const data = { safe: "value" };

      // These should not throw, just skip
      const { cleanData } = encryptFields({
        data,
        fields: ["__proto__", "constructor", "prototype"],
        aesKey: key,
      });
      expect(cleanData.safe).toBe("value");
    });

    it("decryption fails with wrong key", () => {
      const key1 = makeKey();
      const key2 = makeKey();
      const data = { secret: "classified" };

      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: ["secret"],
        aesKey: key1,
      });

      expect(() =>
        decryptFields({ cleanData, encryptedData, aesKey: key2 }),
      ).toThrow();
    });

    it("each field gets unique IV (no IV reuse)", () => {
      const key = makeKey();
      const data = { field1: "a", field2: "a" };

      const { encryptedData } = encryptFields({
        data,
        fields: ["field1", "field2"],
        aesKey: key,
      });

      expect(encryptedData.field1.iv).not.toBe(encryptedData.field2.iv);
    });

    it("decryptFields silently skips prototype pollution paths in encryptedData", () => {
      const key = makeKey();
      const data = { safe: "value" };
      const { cleanData, encryptedData } = encryptFields({
        data,
        fields: ["safe"],
        aesKey: key,
      });

      // Inject a malicious key alongside real encrypted data
      const poisoned = Object.assign(
        { ...encryptedData },
        {
          constructor: encryptedData.safe,
        },
      ) as Record<string, unknown>;

      const result = decryptFields({
        cleanData,
        encryptedData: poisoned as unknown as Record<
          string,
          { ciphertext: string; iv: string; authTag: string }
        >,
        aesKey: key,
      });
      // safe field decrypted normally
      expect(result.safe).toBe("value");
      // constructor should not have been set as own data property
      expect(result.constructor).toBe(Object);
    });
  });
});
