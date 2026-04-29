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

      const { cleanData, encryptedData } = encryptFields(
        data,
        ["name", "email"],
        key,
      );

      expect(cleanData.name).toBeUndefined();
      expect(cleanData.email).toBeUndefined();
      expect(cleanData.age).toBe(30);
      expect(encryptedData.name).toBeDefined();
      expect(encryptedData.name.ciphertext).toBeTruthy();
      expect(encryptedData.name.iv).toBeTruthy();
      expect(encryptedData.name.authTag).toBeTruthy();

      const restored = decryptFields(cleanData, encryptedData, key);
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

      const { cleanData, encryptedData } = encryptFields(
        data,
        ["address.street", "address.city"],
        key,
      );

      expect(
        (cleanData.address as Record<string, unknown>).street,
      ).toBeUndefined();
      expect(
        (cleanData.address as Record<string, unknown>).city,
      ).toBeUndefined();
      expect(cleanData.active).toBe(true);

      const restored = decryptFields(cleanData, encryptedData, key);
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

      const { cleanData, encryptedData } = encryptFields(
        data,
        ["secret", "count"],
        key,
      );

      expect(cleanData.secret).toBeUndefined();
      expect(cleanData.count).toBeUndefined();

      const restored = decryptFields(cleanData, encryptedData, key);
      expect(restored.secret).toEqual({ nested: [1, 2, 3] });
      expect(restored.count).toBe(42);
    });
  });

  describe("edge cases", () => {
    it("skips undefined fields without error", () => {
      const key = makeKey();
      const data = { name: "Alice" };

      const { cleanData, encryptedData } = encryptFields(
        data,
        ["name", "nonexistent", "deep.path.missing"],
        key,
      );

      expect(cleanData.name).toBeUndefined();
      expect(Object.keys(encryptedData)).toEqual(["name"]);
    });

    it("returns original data when fields array is empty", () => {
      const key = makeKey();
      const data = { name: "Alice", age: 30 };

      const { cleanData, encryptedData } = encryptFields(data, [], key);

      expect(cleanData).toEqual(data);
      expect(Object.keys(encryptedData)).toHaveLength(0);
    });

    it("does not mutate the original data object", () => {
      const key = makeKey();
      const original = { name: "Alice", age: 30 };
      const copy = { ...original };

      encryptFields(original, ["name"], key);

      expect(original).toEqual(copy);
    });

    it("decryptFields does not mutate cleanData input", () => {
      const key = makeKey();
      const data = { name: "Alice", age: 30 };
      const { cleanData, encryptedData } = encryptFields(data, ["name"], key);
      const cleanCopy = JSON.parse(JSON.stringify(cleanData));

      decryptFields(cleanData, encryptedData, key);

      expect(cleanData).toEqual(cleanCopy);
    });

    it("rejects prototype pollution paths silently", () => {
      const key = makeKey();
      const data = { safe: "value" };

      // These should not throw, just skip
      const { cleanData } = encryptFields(
        data,
        ["__proto__", "constructor", "prototype"],
        key,
      );
      expect(cleanData.safe).toBe("value");
    });

    it("decryption fails with wrong key", () => {
      const key1 = makeKey();
      const key2 = makeKey();
      const data = { secret: "classified" };

      const { cleanData, encryptedData } = encryptFields(
        data,
        ["secret"],
        key1,
      );

      expect(() => decryptFields(cleanData, encryptedData, key2)).toThrow();
    });

    it("each field gets unique IV (no IV reuse)", () => {
      const key = makeKey();
      const data = { field1: "a", field2: "a" };

      const { encryptedData } = encryptFields(data, ["field1", "field2"], key);

      expect(encryptedData.field1.iv).not.toBe(encryptedData.field2.iv);
    });

    it("decryptFields silently skips prototype pollution paths in encryptedData", () => {
      const key = makeKey();
      const data = { safe: "value" };
      const { cleanData, encryptedData } = encryptFields(data, ["safe"], key);

      // Inject a malicious key alongside real encrypted data
      const poisoned: Record<string, unknown> = { ...encryptedData };
      poisoned["constructor"] = encryptedData.safe;

      const result = decryptFields(
        cleanData,
        poisoned as unknown as Record<string, { ciphertext: string; iv: string; authTag: string }>,
        key,
      );
      // safe field decrypted normally
      expect(result.safe).toBe("value");
      // constructor should not have been set as own data property
      expect(result.constructor).toBe(Object);
    });
  });
});
