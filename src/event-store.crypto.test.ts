import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "./event-store";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
  testSecretValue,
} from "./__tests__/setup";
import { CryptoKeyNotFoundError, CryptoKeyRevokedError } from "./errors";
import type { StoredEvent, TombstonedEvent } from "./types";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

function makeStore() {
  return new EventStore({
    pool,
    schema: uniqueSchema(),
    secrets: [{ version: 1, value: testSecretValue() }],
  });
}

describe("EventStore crypto / GDPR", () => {
  // ---------------------------------------------------------------------------
  // CryptoKeyManager via EventStore
  // ---------------------------------------------------------------------------

  describe("createCryptoKey", () => {
    it("creates a key and is idempotent", async () => {
      const store = makeStore();
      await store.setup();

      await store.createCryptoKey("user:1");
      // Second call should not throw
      await store.createCryptoKey("user:1");
    });
  });

  // ---------------------------------------------------------------------------
  // Encrypt / Decrypt round-trip
  // ---------------------------------------------------------------------------

  describe("encrypt and decrypt events", () => {
    it("encrypts PII fields on append and decrypts on load", async () => {
      const store = makeStore();
      await store.setup();
      await store.createCryptoKey("user:alice");

      await store.append({
        streamId: "User-alice",
        expectedVersion: -1,
        events: [
          {
            type: "UserRegistered",
            data: { name: "Alice", email: "alice@test.com", age: 30 },
            encryptedFields: ["name", "email"],
            cryptoKeyId: "user:alice",
          },
        ],
      });

      const events = await store.load("User-alice");
      expect(events).toHaveLength(1);

      const event = events[0] as StoredEvent;
      expect(event.data).toEqual({
        name: "Alice",
        email: "alice@test.com",
        age: 30,
      });
    });

    it("encrypted fields are removed from data column (verify raw)", async () => {
      const store = makeStore();
      await store.setup();
      await store.createCryptoKey("user:bob");

      await store.append({
        streamId: "User-bob",
        expectedVersion: -1,
        events: [
          {
            type: "UserRegistered",
            data: { name: "Bob", public: "visible" },
            encryptedFields: ["name"],
            cryptoKeyId: "user:bob",
          },
        ],
      });

      // Read raw from DB to verify data column doesn't contain PII
      const schema = (store as unknown as { schema: string }).schema;
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT data, encrypted_data FROM ${schema}.events WHERE stream_id = 'User-bob'`,
        );
        const row = result.rows[0] as {
          data: Record<string, unknown>;
          encrypted_data: Record<string, { ciphertext: string }>;
        };
        expect(row.data.name).toBeUndefined();
        expect(row.data.public).toBe("visible");
        expect(row.encrypted_data.name).toBeDefined();
        expect(row.encrypted_data.name.ciphertext).toBeTruthy();
      } finally {
        client.release();
      }
    });

    it("nested encrypted fields work", async () => {
      const store = makeStore();
      await store.setup();
      await store.createCryptoKey("user:carol");

      await store.append({
        streamId: "User-carol",
        expectedVersion: -1,
        events: [
          {
            type: "UserRegistered",
            data: {
              address: { street: "123 Main", city: "Berlin" },
              active: true,
            },
            encryptedFields: ["address.street", "address.city"],
            cryptoKeyId: "user:carol",
          },
        ],
      });

      const events = await store.load("User-carol");
      const data = events[0].data as Record<string, unknown>;
      const address = data.address as Record<string, unknown>;
      expect(address.street).toBe("123 Main");
      expect(address.city).toBe("Berlin");
      expect(data.active).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Key revocation / Tombstones
  // ---------------------------------------------------------------------------

  describe("key revocation and tombstones", () => {
    it("returns tombstoned events after key revocation", async () => {
      const store = makeStore();
      await store.setup();
      await store.createCryptoKey("user:dave");

      await store.append({
        streamId: "User-dave",
        expectedVersion: -1,
        events: [
          {
            type: "UserRegistered",
            data: { name: "Dave", public: "ok" },
            encryptedFields: ["name"],
            cryptoKeyId: "user:dave",
          },
        ],
      });

      // Verify data is readable before revocation
      let events = await store.load("User-dave");
      expect((events[0] as StoredEvent).data).toEqual({
        name: "Dave",
        public: "ok",
      });

      // Revoke key
      await store.revokeKey("user:dave");

      // After revocation, events become tombstones
      events = await store.load("User-dave");
      expect(events).toHaveLength(1);
      const tombstone = events[0] as TombstonedEvent;
      expect(tombstone.data).toBeNull();
      expect(tombstone.tombstoned).toBe(true);
      // Type and extensions should still be available
      expect(tombstone.type).toBe("UserRegistered");
      expect(tombstone.extensions).toBeDefined();
    });

    it("revokeKey is idempotent", async () => {
      const store = makeStore();
      await store.setup();
      await store.createCryptoKey("user:frank");

      await store.revokeKey("user:frank");
      // Second revoke should not throw
      await store.revokeKey("user:frank");
    });

    it("revokeKey throws CryptoKeyNotFoundError for missing key", async () => {
      const store = makeStore();
      await store.setup();

      await expect(store.revokeKey("nonexistent")).rejects.toThrow(
        CryptoKeyNotFoundError,
      );
    });

    it("append with revoked key throws CryptoKeyRevokedError", async () => {
      const store = makeStore();
      await store.setup();
      await store.createCryptoKey("user:gone");
      await store.revokeKey("user:gone");

      await expect(
        store.append({
          streamId: "User-gone",
          expectedVersion: -1,
          events: [
            {
              type: "UserRegistered",
              data: { name: "Ghost" },
              encryptedFields: ["name"],
              cryptoKeyId: "user:gone",
            },
          ],
        }),
      ).rejects.toThrow(CryptoKeyRevokedError);
    });
  });

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Versioned secret rotation
  // ---------------------------------------------------------------------------

  describe("versioned secret rotation", () => {
    it("loads versioned secrets from GDPR_CRYPTO_SECRETS", async () => {
      const schema = uniqueSchema();
      const previous = process.env.GDPR_CRYPTO_SECRETS;
      process.env.GDPR_CRYPTO_SECRETS = "8:environment-secret,3:old-secret";
      try {
        const store = new EventStore({ pool, schema });
        await store.setup();
        await store.createCryptoKey("user:environment");

        const client = await pool.connect();
        try {
          const result = await client.query<{ encrypted_key: Buffer }>(
            `SELECT encrypted_key FROM ${schema}.crypto_keys WHERE key_id = 'user:environment'`,
          );
          expect(result.rows[0].encrypted_key.readUInt32BE(4)).toBe(8);
        } finally {
          client.release();
        }
      } finally {
        if (previous === undefined) delete process.env.GDPR_CRYPTO_SECRETS;
        else process.env.GDPR_CRYPTO_SECRETS = previous;
      }
    });

    it("reads old versions and lazily re-wraps on the next write", async () => {
      const schema = uniqueSchema();
      const oldStore = new EventStore({
        pool,
        schema,
        secrets: [{ version: 1, value: "old-secret" }],
      });
      await oldStore.setup();
      await oldStore.createCryptoKey("user:rotated");
      await oldStore.append({
        streamId: "User-rotated",
        expectedVersion: -1,
        events: [
          {
            type: "Registered",
            data: { name: "Alice" },
            encryptedFields: ["name"],
            cryptoKeyId: "user:rotated",
          },
        ],
      });

      const client = await pool.connect();
      try {
        const before = await client.query<{
          encrypted_key: Buffer;
          encrypted_data: Record<string, { version: number }>;
        }>(
          `SELECT k.encrypted_key, e.encrypted_data
           FROM ${schema}.crypto_keys k
           JOIN ${schema}.events e ON e.crypto_key_id = k.key_id
           WHERE k.key_id = 'user:rotated' AND e.stream_version = 1`,
        );
        expect(before.rows[0].encrypted_key.readUInt32BE(4)).toBe(1);
        expect(before.rows[0].encrypted_data.name.version).toBe(1);

        const rotatedStore = new EventStore({
          pool,
          schema,
          secrets: [
            { version: 3, value: "new-secret" },
            { version: 1, value: "old-secret" },
          ],
        });
        await rotatedStore.setup();

        expect((await rotatedStore.load("User-rotated"))[0].data).toEqual({
          name: "Alice",
        });
        await rotatedStore.append({
          streamId: "User-rotated",
          expectedVersion: 1,
          events: [
            {
              type: "Renamed",
              data: { name: "Bob" },
              encryptedFields: ["name"],
              cryptoKeyId: "user:rotated",
            },
          ],
        });

        const after = await client.query<{
          encrypted_key: Buffer;
          encrypted_data: Record<string, { version: number }>;
        }>(
          `SELECT k.encrypted_key, e.encrypted_data
           FROM ${schema}.crypto_keys k
           JOIN ${schema}.events e ON e.crypto_key_id = k.key_id
           WHERE k.key_id = 'user:rotated' AND e.stream_version = 1`,
        );
        const newEvent = await client.query<{
          encrypted_data: Record<string, { version: number }>;
        }>(
          `SELECT encrypted_data FROM ${schema}.events
           WHERE stream_id = 'User-rotated' AND stream_version = 2`,
        );
        expect(
          after.rows[0].encrypted_key.equals(before.rows[0].encrypted_key),
        ).toBe(false);
        expect(after.rows[0].encrypted_key.readUInt32BE(4)).toBe(3);
        expect(after.rows[0].encrypted_data.name.version).toBe(1);
        expect(newEvent.rows[0].encrypted_data.name.version).toBe(3);
        expect((await rotatedStore.load("User-rotated"))[1].data).toEqual({
          name: "Bob",
        });
      } finally {
        client.release();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Events without encryption load fine alongside encrypted events
  // ---------------------------------------------------------------------------

  describe("mixed encrypted / unencrypted", () => {
    it("loads mixed events correctly", async () => {
      const store = makeStore();
      await store.setup();
      await store.createCryptoKey("user:mix");

      await store.append({
        streamId: "Mix-1",
        expectedVersion: -1,
        events: [
          { type: "Public", data: { info: "visible" } },
          {
            type: "Private",
            data: { name: "Secret" },
            encryptedFields: ["name"],
            cryptoKeyId: "user:mix",
          },
        ],
      });

      const events = await store.load("Mix-1");
      expect(events).toHaveLength(2);
      expect(events[0].data).toEqual({ info: "visible" });
      expect(events[1].data).toEqual({ name: "Secret" });
    });
  });
});
