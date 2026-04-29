import { describe, it, expect } from "vitest";
import {
  OptimisticConcurrencyError,
  StreamNotFoundError,
  CryptoKeyRevokedError,
  CryptoKeyNotFoundError,
  MasterKeyRequiredError,
  EventStoreNotInitializedError,
  InvalidSchemaNameError,
} from "./errors";

describe("errors", () => {
  describe("OptimisticConcurrencyError", () => {
    it("sets name, message, and properties", () => {
      const err = new OptimisticConcurrencyError("stream-1", 3, 5);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(OptimisticConcurrencyError);
      expect(err.name).toBe("OptimisticConcurrencyError");
      expect(err.streamId).toBe("stream-1");
      expect(err.expectedVersion).toBe(3);
      expect(err.actualVersion).toBe(5);
      expect(err.message).toContain("stream-1");
      expect(err.message).toContain("3");
      expect(err.message).toContain("5");
    });
  });

  describe("StreamNotFoundError", () => {
    it("sets name and streamId", () => {
      const err = new StreamNotFoundError("missing-stream");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("StreamNotFoundError");
      expect(err.streamId).toBe("missing-stream");
      expect(err.message).toContain("missing-stream");
    });
  });

  describe("CryptoKeyRevokedError", () => {
    it("sets name and keyId", () => {
      const err = new CryptoKeyRevokedError("key-abc");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CryptoKeyRevokedError");
      expect(err.keyId).toBe("key-abc");
      expect(err.message).toContain("revoked");
    });
  });

  describe("CryptoKeyNotFoundError", () => {
    it("sets name and keyId", () => {
      const err = new CryptoKeyNotFoundError("key-xyz");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CryptoKeyNotFoundError");
      expect(err.keyId).toBe("key-xyz");
      expect(err.message).toContain("not found");
    });
  });

  describe("MasterKeyRequiredError", () => {
    it("sets name and descriptive message", () => {
      const err = new MasterKeyRequiredError();
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("MasterKeyRequiredError");
      expect(err.message).toContain("masterEncryptionKey");
    });
  });

  describe("EventStoreNotInitializedError", () => {
    it("sets name and mentions setup()", () => {
      const err = new EventStoreNotInitializedError();
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("EventStoreNotInitializedError");
      expect(err.message).toContain("setup()");
    });
  });

  describe("InvalidSchemaNameError", () => {
    it("sets name and schemaName", () => {
      const err = new InvalidSchemaNameError("DROP TABLE;");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidSchemaNameError");
      expect(err.schemaName).toBe("DROP TABLE;");
      expect(err.message).toContain("DROP TABLE;");
    });
  });

  it("all errors can be discriminated by name property", () => {
    const errors: Error[] = [
      new OptimisticConcurrencyError("s", 1, 2),
      new StreamNotFoundError("s"),
      new CryptoKeyRevokedError("k"),
      new CryptoKeyNotFoundError("k"),
      new MasterKeyRequiredError(),
      new EventStoreNotInitializedError(),
      new InvalidSchemaNameError("x"),
    ];

    const names = errors.map((e) => e.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(errors.length);
  });
});
