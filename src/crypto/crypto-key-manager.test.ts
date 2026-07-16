import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { CryptoKeyManager } from "./crypto-key-manager";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
  testSecretValue,
} from "../__tests__/setup";
import { EventStore } from "../event-store";
import {
  CryptoKeyNotFoundError,
  CryptoKeyRevokedError,
  InvalidCryptoSecretsError,
} from "../errors";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

describe("CryptoKeyManager", () => {
  describe("constructor", () => {
    it("throws InvalidCryptoSecretsError for an empty secret list", () => {
      expect(() => new CryptoKeyManager({ secrets: [] })).toThrow(
        InvalidCryptoSecretsError,
      );
    });

    it("throws for an empty secret value", () => {
      expect(
        () => new CryptoKeyManager({ secrets: [{ version: 1, value: "" }] }),
      ).toThrow(InvalidCryptoSecretsError);
    });

    it("accepts a configured secret", () => {
      expect(
        () =>
          new CryptoKeyManager({
            secrets: [{ version: 1, value: testSecretValue() }],
          }),
      ).not.toThrow();
    });
  });

  describe("createKey + getKey", () => {
    it("creates and retrieves a key (round-trip)", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${schema}`);
        await mgr.createKey({ client, schema, keyId: "user:1" });
        const key = await mgr.getKey({ client, schema, keyId: "user:1" });
        expect(key).toBeInstanceOf(Buffer);
        expect(key!.length).toBe(32);
      } finally {
        client.release();
      }
    });

    it("rejects non-versioned entity key envelopes", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await mgr.createKey({ client, schema, keyId: "user:unversioned" });
        await client.query(
          `UPDATE ${schema}.crypto_keys SET encrypted_key = $1 WHERE key_id = $2`,
          [Buffer.alloc(60), "user:unversioned"],
        );

        await expect(
          mgr.getKey({ client, schema, keyId: "user:unversioned" }),
        ).rejects.toThrow("Invalid versioned crypto key envelope");
      } finally {
        client.release();
      }
    });

    it("createKey is idempotent", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await mgr.createKey({ client, schema, keyId: "user:idem" });
        const key1 = await mgr.getKey({ client, schema, keyId: "user:idem" });

        // Second create should be no-op (ON CONFLICT DO NOTHING)
        await mgr.createKey({ client, schema, keyId: "user:idem" });
        const key2 = await mgr.getKey({ client, schema, keyId: "user:idem" });

        // Same key returned both times
        expect(key1!.equals(key2!)).toBe(true);
      } finally {
        client.release();
      }
    });

    it("getKey throws CryptoKeyNotFoundError for missing key", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await expect(
          mgr.getKey({ client, schema, keyId: "nonexistent" }),
        ).rejects.toThrow(CryptoKeyNotFoundError);
      } finally {
        client.release();
      }
    });
  });

  describe("revokeKey", () => {
    it("revoked key returns null from getKey", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await mgr.createKey({ client, schema, keyId: "user:revoke" });
        await mgr.revokeKey({ client, schema, keyId: "user:revoke" });
        const key = await mgr.getKey({ client, schema, keyId: "user:revoke" });
        expect(key).toBeNull();
      } finally {
        client.release();
      }
    });

    it("revokeKey is idempotent", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await mgr.createKey({ client, schema, keyId: "user:rev2" });
        await mgr.revokeKey({ client, schema, keyId: "user:rev2" });
        // Second revoke should not throw
        await mgr.revokeKey({ client, schema, keyId: "user:rev2" });
      } finally {
        client.release();
      }
    });

    it("revokeKey throws CryptoKeyNotFoundError for missing key", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await expect(
          mgr.revokeKey({ client, schema, keyId: "ghost" }),
        ).rejects.toThrow(CryptoKeyNotFoundError);
      } finally {
        client.release();
      }
    });
  });

  describe("getKeyForEncryption", () => {
    it("returns key for active key", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await mgr.createKey({ client, schema, keyId: "user:enc" });
        const key = await mgr.getKeyForEncryption({
          client,
          schema,
          keyId: "user:enc",
        });
        expect(key).toBeInstanceOf(Buffer);
        expect(key.length).toBe(32);
      } finally {
        client.release();
      }
    });

    it("throws CryptoKeyRevokedError for revoked key", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      await store.setup();

      const mgr = new CryptoKeyManager({
        secrets: [{ version: 1, value: testSecretValue() }],
      });
      const client = await pool.connect();
      try {
        await mgr.createKey({ client, schema, keyId: "user:enc2" });
        await mgr.revokeKey({ client, schema, keyId: "user:enc2" });
        await expect(
          mgr.getKeyForEncryption({ client, schema, keyId: "user:enc2" }),
        ).rejects.toThrow(CryptoKeyRevokedError);
      } finally {
        client.release();
      }
    });
  });

  describe("envelope encryption integrity", () => {
    it("different secrets cannot decrypt each other's entity keys", async () => {
      const schema = uniqueSchema();
      const secretValue1 = "a".repeat(64);
      const secretValue2 = "b".repeat(64);

      const store = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: secretValue1 }],
      });
      await store.setup();

      const mgr1 = new CryptoKeyManager({
        secrets: [{ version: 1, value: secretValue1 }],
      });
      const mgr2 = new CryptoKeyManager({
        secrets: [{ version: 1, value: secretValue2 }],
      });

      const client = await pool.connect();
      try {
        await mgr1.createKey({ client, schema, keyId: "user:cross" });
        // mgr2 tries to decrypt a key encrypted by mgr1
        await expect(
          mgr2.getKey({ client, schema, keyId: "user:cross" }),
        ).rejects.toThrow();
      } finally {
        client.release();
      }
    });
  });
});
