import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { CryptoKeyManager } from "./crypto-key-manager";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
  testMasterKey,
} from "../__tests__/setup";
import { EventStore } from "../event-store";
import {
  CryptoKeyNotFoundError,
  CryptoKeyRevokedError,
  MasterKeyRequiredError,
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
    it("throws MasterKeyRequiredError for empty key", () => {
      expect(() => new CryptoKeyManager("")).toThrow(MasterKeyRequiredError);
    });

    it("throws for wrong key length", () => {
      expect(() => new CryptoKeyManager("aabbccdd")).toThrow(/256 bits/);
    });

    it("accepts valid 64-char hex key", () => {
      expect(() => new CryptoKeyManager(testMasterKey())).not.toThrow();
    });
  });

  describe("createKey + getKey", () => {
    it("creates and retrieves a key (round-trip)", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${schema}`);
        await mgr.createKey(client, schema, "user:1");
        const key = await mgr.getKey(client, schema, "user:1");
        expect(key).toBeInstanceOf(Buffer);
        expect(key!.length).toBe(32);
      } finally {
        client.release();
      }
    });

    it("createKey is idempotent", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await mgr.createKey(client, schema, "user:idem");
        const key1 = await mgr.getKey(client, schema, "user:idem");

        // Second create should be no-op (ON CONFLICT DO NOTHING)
        await mgr.createKey(client, schema, "user:idem");
        const key2 = await mgr.getKey(client, schema, "user:idem");

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
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await expect(mgr.getKey(client, schema, "nonexistent")).rejects.toThrow(
          CryptoKeyNotFoundError,
        );
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
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await mgr.createKey(client, schema, "user:revoke");
        await mgr.revokeKey(client, schema, "user:revoke");
        const key = await mgr.getKey(client, schema, "user:revoke");
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
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await mgr.createKey(client, schema, "user:rev2");
        await mgr.revokeKey(client, schema, "user:rev2");
        // Second revoke should not throw
        await mgr.revokeKey(client, schema, "user:rev2");
      } finally {
        client.release();
      }
    });

    it("revokeKey throws CryptoKeyNotFoundError for missing key", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({
        pool,
        schema,
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await expect(mgr.revokeKey(client, schema, "ghost")).rejects.toThrow(
          CryptoKeyNotFoundError,
        );
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
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await mgr.createKey(client, schema, "user:enc");
        const key = await mgr.getKeyForEncryption(client, schema, "user:enc");
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
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();

      const mgr = new CryptoKeyManager(testMasterKey());
      const client = await pool.connect();
      try {
        await mgr.createKey(client, schema, "user:enc2");
        await mgr.revokeKey(client, schema, "user:enc2");
        await expect(
          mgr.getKeyForEncryption(client, schema, "user:enc2"),
        ).rejects.toThrow(CryptoKeyRevokedError);
      } finally {
        client.release();
      }
    });
  });

  describe("envelope encryption integrity", () => {
    it("different master keys cannot decrypt each other's entity keys", async () => {
      const schema = uniqueSchema();
      const masterKey1 = "a".repeat(64);
      const masterKey2 = "b".repeat(64);

      const store = new EventStore({
        pool,
        schema,
        masterEncryptionKey: masterKey1,
      });
      await store.setup();

      const mgr1 = new CryptoKeyManager(masterKey1);
      const mgr2 = new CryptoKeyManager(masterKey2);

      const client = await pool.connect();
      try {
        await mgr1.createKey(client, schema, "user:cross");
        // mgr2 tries to decrypt a key encrypted by mgr1
        await expect(
          mgr2.getKey(client, schema, "user:cross"),
        ).rejects.toThrow();
      } finally {
        client.release();
      }
    });
  });
});
