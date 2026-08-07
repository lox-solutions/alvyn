import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestPool,
  startPostgres,
  stopPostgres,
  uniqueSchema,
} from "./__tests__/setup";
import { CryptoKeyManager } from "./crypto/crypto-key-manager";
import { EventStore } from "./event-store";
import {
  CryptoKeyIdRequiredError,
  CryptoKeyNotFoundError,
  CryptoKeyRevokedError,
  CryptoSecretVersionNotFoundError,
  CryptoSecretsRequiredError,
} from "./errors";
import type { CryptoSecretsConfig, TombstonedEvent } from "./types";

const SECRET_1 = "11".repeat(32);
const SECRET_2 = "22".repeat(32);
const VERSION_1 = {
  currentVersion: 1,
  secrets: [{ version: 1, value: SECRET_1 }],
} as const;

interface RawEvent {
  data: Record<string, unknown>;
  encrypted_data: Record<
    string,
    { version: number; ciphertext: string; iv: string; authTag: string }
  > | null;
  stream_version: number;
}

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

function makeStore(
  schema: string,
  secrets: CryptoSecretsConfig = VERSION_1,
): EventStore {
  return new EventStore({
    pool,
    schema,
    secrets: {
      currentVersion: secrets.currentVersion,
      secrets: [...secrets.secrets],
    },
  });
}

async function appendPrivateName(options: {
  store: EventStore;
  streamId: string;
  keyId: string;
  name: string;
  expectedVersion: number;
  client?: pg.PoolClient;
}): Promise<void> {
  await options.store.append(
    {
      streamId: options.streamId,
      expectedVersion: options.expectedVersion,
      events: [
        {
          type: options.expectedVersion === -1 ? "Registered" : "Renamed",
          data: { name: options.name },
          encryptedFields: ["name"],
          cryptoKeyId: options.keyId,
        },
      ],
    },
    options.client ? { client: options.client } : undefined,
  );
}

async function readEnvelope(schema: string, keyId: string): Promise<Buffer> {
  const result = await pool.query<{ encrypted_key: Buffer }>(
    `SELECT encrypted_key FROM ${schema}.crypto_keys WHERE key_id = $1`,
    [keyId],
  );
  return result.rows[0].encrypted_key;
}

async function readRawEvents(
  schema: string,
  streamId: string,
): Promise<RawEvent[]> {
  const result = await pool.query<RawEvent>(
    `SELECT data, encrypted_data, stream_version
     FROM ${schema}.events
     WHERE stream_id = $1
     ORDER BY stream_version`,
    [streamId],
  );
  return result.rows;
}

describe("encrypted events", () => {
  it("rejects encrypted writes without configured secrets", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    await expect(
      store.append({
        streamId: "User-no-secrets",
        expectedVersion: -1,
        events: [
          {
            type: "Registered",
            data: { name: "Alice" },
            encryptedFields: ["name"],
            cryptoKeyId: "user:no-secrets",
          },
        ],
      }),
    ).rejects.toThrow(CryptoSecretsRequiredError);

    expect(await readRawEvents(schema, "User-no-secrets")).toHaveLength(0);
  });

  it.each([undefined, ""])(
    "rejects encrypted writes without a crypto key ID (%j)",
    async (cryptoKeyId) => {
      const schema = uniqueSchema();
      const store = makeStore(schema);
      await store.setup();

      await expect(
        store.append({
          streamId: "User-no-key-id",
          expectedVersion: -1,
          events: [
            {
              type: "Registered",
              data: { name: "Alice" },
              encryptedFields: ["name"],
              cryptoKeyId,
            },
          ],
        }),
      ).rejects.toThrow(CryptoKeyIdRequiredError);

      expect(await readRawEvents(schema, "User-no-key-id")).toHaveLength(0);
    },
  );

  it("keeps PII out of the data column and restores it when loading", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:alice");

    await store.append({
      streamId: "User-alice",
      expectedVersion: -1,
      events: [
        {
          type: "Registered",
          data: {
            name: "Alice",
            address: { street: "Main Street", city: "Berlin" },
            active: true,
          },
          encryptedFields: ["name", "address.street"],
          cryptoKeyId: "user:alice",
        },
      ],
    });

    const [raw] = await readRawEvents(schema, "User-alice");
    expect(raw.data).toEqual({ address: { city: "Berlin" }, active: true });
    expect(Object.keys(raw.encrypted_data!)).toEqual([
      "name",
      "address.street",
    ]);
    expect((await store.load("User-alice"))[0].data).toEqual({
      name: "Alice",
      address: { street: "Main Street", city: "Berlin" },
      active: true,
    });
  });

  it("keeps encrypted PII out of transactional outbox payloads", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:outbox");

    await store.append({
      streamId: "User-outbox",
      expectedVersion: -1,
      outboxTopics: ["users"],
      events: [
        {
          type: "Registered",
          data: { name: "Alice", active: true },
          encryptedFields: ["name"],
          cryptoKeyId: "user:outbox",
        },
      ],
    });

    const payloads: Record<string, unknown>[] = [];
    await store.processOutbox((entries) => {
      payloads.push(
        ...entries.map((entry) => entry.payload as Record<string, unknown>),
      );
      return Promise.resolve();
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].data).toEqual({ active: true });
    expect(JSON.stringify(payloads)).not.toContain("Alice");
  });

  it("returns a tombstone when the encrypted event key row is missing", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:missing-row");
    await appendPrivateName({
      store,
      streamId: "User-missing-row",
      keyId: "user:missing-row",
      name: "Alice",
      expectedVersion: -1,
    });

    await pool.query(`DELETE FROM ${schema}.crypto_keys WHERE key_id = $1`, [
      "user:missing-row",
    ]);

    await expect(store.load("User-missing-row")).resolves.toMatchObject([
      { data: null, tombstoned: true },
    ]);
  });

  it("returns a tombstone when encrypted data is read without secrets", async () => {
    const schema = uniqueSchema();
    const source = makeStore(schema);
    await source.setup();
    await source.createCryptoKey("user:no-read-secrets");
    await appendPrivateName({
      store: source,
      streamId: "User-no-read-secrets",
      keyId: "user:no-read-secrets",
      name: "Alice",
      expectedVersion: -1,
    });

    const previous = process.env.GDPR_CRYPTO_SECRETS;
    const previousCurrentVersion = process.env.GDPR_CRYPTO_CURRENT_VERSION;
    delete process.env.GDPR_CRYPTO_SECRETS;
    delete process.env.GDPR_CRYPTO_CURRENT_VERSION;
    try {
      const reader = new EventStore({ pool, schema });
      await reader.setup();

      await expect(reader.load("User-no-read-secrets")).resolves.toMatchObject([
        { data: null, tombstoned: true },
      ]);
    } finally {
      if (previous === undefined) delete process.env.GDPR_CRYPTO_SECRETS;
      else process.env.GDPR_CRYPTO_SECRETS = previous;
      if (previousCurrentVersion === undefined)
        delete process.env.GDPR_CRYPTO_CURRENT_VERSION;
      else process.env.GDPR_CRYPTO_CURRENT_VERSION = previousCurrentVersion;
    }
  });

  it("loads public and encrypted events from the same stream", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:mixed");

    await store.append({
      streamId: "User-mixed",
      expectedVersion: -1,
      events: [
        { type: "Public", data: { status: "active" } },
        {
          type: "Private",
          data: { name: "Alice" },
          encryptedFields: ["name"],
          cryptoKeyId: "user:mixed",
        },
      ],
    });

    expect((await store.load("User-mixed")).map((event) => event.data)).toEqual(
      [{ status: "active" }, { name: "Alice" }],
    );
  });

  it("rejects encrypted data moved to another event", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:events");
    await appendPrivateName({
      store,
      streamId: "User-events",
      keyId: "user:events",
      name: "Alice",
      expectedVersion: -1,
    });
    await appendPrivateName({
      store,
      streamId: "User-events",
      keyId: "user:events",
      name: "Bob",
      expectedVersion: 1,
    });
    await pool.query(
      `UPDATE ${schema}.events AS target
       SET encrypted_data = source.encrypted_data
       FROM ${schema}.events AS source
       WHERE target.stream_id = 'User-events'
         AND target.stream_version = 2
         AND source.stream_id = 'User-events'
         AND source.stream_version = 1`,
    );

    await expect(store.load("User-events")).rejects.toThrow();
  });
});

describe("crypto-shredding", () => {
  it("turns encrypted events into metadata-preserving tombstones", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:shred");
    await appendPrivateName({
      store,
      streamId: "User-shred",
      keyId: "user:shred",
      name: "Alice",
      expectedVersion: -1,
    });

    await store.revokeKey("user:shred");
    await store.revokeKey("user:shred");

    const tombstone = (await store.load("User-shred"))[0] as TombstonedEvent;
    expect(tombstone).toMatchObject({
      type: "Registered",
      data: null,
      tombstoned: true,
      streamId: "User-shred",
      streamVersion: 1,
    });
  });

  it("does not affect public events", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:public");
    await store.append({
      streamId: "User-public",
      expectedVersion: -1,
      events: [
        { type: "Public", data: { status: "active" } },
        {
          type: "Private",
          data: { name: "Alice" },
          encryptedFields: ["name"],
          cryptoKeyId: "user:public",
        },
      ],
    });

    await store.revokeKey("user:public");

    const events = await store.load("User-public");
    expect(events[0].data).toEqual({ status: "active" });
    expect((events[1] as TombstonedEvent).tombstoned).toBe(true);
  });

  it("rejects missing keys and writes with revoked keys", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:gone");
    await store.revokeKey("user:gone");

    await expect(store.revokeKey("missing")).rejects.toThrow(
      CryptoKeyNotFoundError,
    );
    await expect(
      appendPrivateName({
        store,
        streamId: "User-gone",
        keyId: "user:gone",
        name: "Ghost",
        expectedVersion: -1,
      }),
    ).rejects.toThrow(CryptoKeyRevokedError);
  });
});

describe("secret rotation", () => {
  it("uses GDPR_CRYPTO_SECRETS when code configuration is absent", async () => {
    const schema = uniqueSchema();
    const previous = process.env.GDPR_CRYPTO_SECRETS;
    const previousCurrentVersion = process.env.GDPR_CRYPTO_CURRENT_VERSION;
    process.env.GDPR_CRYPTO_SECRETS = "8:environment-secret,3:old-secret";
    process.env.GDPR_CRYPTO_CURRENT_VERSION = "8";
    try {
      const store = new EventStore({ pool, schema });
      await store.setup();
      await store.createCryptoKey("user:environment");

      expect(
        (await readEnvelope(schema, "user:environment")).readUInt32BE(4),
      ).toBe(8);
    } finally {
      if (previous === undefined) delete process.env.GDPR_CRYPTO_SECRETS;
      else process.env.GDPR_CRYPTO_SECRETS = previous;
      if (previousCurrentVersion === undefined)
        delete process.env.GDPR_CRYPTO_CURRENT_VERSION;
      else process.env.GDPR_CRYPTO_CURRENT_VERSION = previousCurrentVersion;
    }
  });

  it("reads with an old secret without rewriting the envelope", async () => {
    const schema = uniqueSchema();
    const original = makeStore(schema);
    await original.setup();
    await original.createCryptoKey("user:read-only");
    await appendPrivateName({
      store: original,
      streamId: "User-read-only",
      keyId: "user:read-only",
      name: "Alice",
      expectedVersion: -1,
    });
    const before = await readEnvelope(schema, "user:read-only");
    const rotated = makeStore(schema, {
      currentVersion: 2,
      secrets: [
        { version: 2, value: SECRET_2 },
        { version: 1, value: SECRET_1 },
      ],
    });
    await rotated.setup();

    expect((await rotated.load("User-read-only"))[0].data).toEqual({
      name: "Alice",
    });
    expect(await readEnvelope(schema, "user:read-only")).toEqual(before);
  });

  it("fails closed when an old secret is removed before rewrapping", async () => {
    const schema = uniqueSchema();
    const original = makeStore(schema);
    await original.setup();
    await original.createCryptoKey("user:removed-secret");
    await appendPrivateName({
      store: original,
      streamId: "User-removed-secret",
      keyId: "user:removed-secret",
      name: "Alice",
      expectedVersion: -1,
    });

    const rotated = makeStore(schema, {
      currentVersion: 2,
      secrets: [{ version: 2, value: SECRET_2 }],
    });
    await rotated.setup();

    await expect(rotated.load("User-removed-secret")).rejects.toThrow(
      CryptoSecretVersionNotFoundError,
    );
  });

  it("lazily rewraps on write and then works with only the new secret", async () => {
    const schema = uniqueSchema();
    const original = makeStore(schema);
    await original.setup();
    await original.createCryptoKey("user:rotated");
    await appendPrivateName({
      store: original,
      streamId: "User-rotated",
      keyId: "user:rotated",
      name: "Alice",
      expectedVersion: -1,
    });
    const oldEventBefore = (await readRawEvents(schema, "User-rotated"))[0]
      .encrypted_data;
    const rotated = makeStore(schema, {
      currentVersion: 2,
      secrets: [
        { version: 2, value: SECRET_2 },
        { version: 1, value: SECRET_1 },
      ],
    });
    await rotated.setup();

    await appendPrivateName({
      store: rotated,
      streamId: "User-rotated",
      keyId: "user:rotated",
      name: "Bob",
      expectedVersion: 1,
    });

    const rawEvents = await readRawEvents(schema, "User-rotated");
    expect((await readEnvelope(schema, "user:rotated")).readUInt32BE(4)).toBe(
      2,
    );
    expect(rawEvents[0].encrypted_data).toEqual(oldEventBefore);
    expect(
      rawEvents.map((event) => event.encrypted_data!.name.version),
    ).toEqual([1, 2]);
    const newOnly = makeStore(schema, {
      currentVersion: 2,
      secrets: [{ version: 2, value: SECRET_2 }],
    });
    await newOnly.setup();
    expect(
      (await newOnly.load("User-rotated")).map((event) => event.data),
    ).toEqual([{ name: "Alice" }, { name: "Bob" }]);
  });

  it("supports a three-replica rolling deployment without envelope downgrade", async () => {
    const schema = uniqueSchema();
    const original = makeStore(schema);
    await original.setup();
    await original.createCryptoKey("user:ha");
    const phaseOneSecrets = {
      currentVersion: 1,
      secrets: [
        { version: 1, value: SECRET_1 },
        { version: 2, value: SECRET_2 },
      ],
    };
    const replicas = [
      makeStore(schema, phaseOneSecrets),
      makeStore(schema, phaseOneSecrets),
      makeStore(schema, phaseOneSecrets),
    ];
    await Promise.all(replicas.map((replica) => replica.setup()));
    await appendPrivateName({
      store: replicas[0],
      streamId: "User-ha",
      keyId: "user:ha",
      name: "Phase one",
      expectedVersion: -1,
    });
    const upgradedReplica = makeStore(schema, {
      currentVersion: 2,
      secrets: [
        { version: 1, value: SECRET_1 },
        { version: 2, value: SECRET_2 },
      ],
    });
    await upgradedReplica.setup();
    await appendPrivateName({
      store: upgradedReplica,
      streamId: "User-ha",
      keyId: "user:ha",
      name: "Phase two",
      expectedVersion: 1,
    });
    const upgradedEnvelope = await readEnvelope(schema, "user:ha");

    await appendPrivateName({
      store: replicas[1],
      streamId: "User-ha",
      keyId: "user:ha",
      name: "Stale replica",
      expectedVersion: 2,
    });

    expect(await readEnvelope(schema, "user:ha")).toEqual(upgradedEnvelope);
    const newOnly = makeStore(schema, {
      currentVersion: 2,
      secrets: [{ version: 2, value: SECRET_2 }],
    });
    await newOnly.setup();
    expect((await newOnly.load("User-ha")).map((event) => event.data)).toEqual([
      { name: "Phase one" },
      { name: "Phase two" },
      { name: "Stale replica" },
    ]);
  });
});

describe("revocation and append concurrency", () => {
  it("serializes append-first and revoke-first transactions across replicas", async () => {
    const schema = uniqueSchema();
    const store = makeStore(schema);
    await store.setup();
    await store.createCryptoKey("user:concurrent");
    const manager = new CryptoKeyManager(VERSION_1);
    const appendClient = await pool.connect();
    const revokeClient = await pool.connect();
    try {
      await appendClient.query("BEGIN");
      await appendPrivateName({
        store,
        streamId: "User-concurrent",
        keyId: "user:concurrent",
        name: "Committed before revocation",
        expectedVersion: -1,
        client: appendClient,
      });
      await revokeClient.query("BEGIN");
      await revokeClient.query("SET LOCAL lock_timeout = '50ms'");
      await expect(
        manager.revokeKey({
          client: revokeClient,
          schema,
          keyId: "user:concurrent",
        }),
      ).rejects.toMatchObject({ code: "55P03" });
      await revokeClient.query("ROLLBACK");
      await appendClient.query("COMMIT");

      await revokeClient.query("BEGIN");
      await manager.revokeKey({
        client: revokeClient,
        schema,
        keyId: "user:concurrent",
      });
      await appendClient.query("BEGIN");
      await appendClient.query("SET LOCAL lock_timeout = '50ms'");
      await expect(
        appendPrivateName({
          store,
          streamId: "User-concurrent",
          keyId: "user:concurrent",
          name: "Must not be written",
          expectedVersion: 1,
          client: appendClient,
        }),
      ).rejects.toMatchObject({ code: "55P03" });
      await appendClient.query("ROLLBACK");
      await revokeClient.query("COMMIT");

      await expect(
        appendPrivateName({
          store,
          streamId: "User-concurrent",
          keyId: "user:concurrent",
          name: "Must still fail",
          expectedVersion: 1,
        }),
      ).rejects.toThrow(CryptoKeyRevokedError);
      expect(await readRawEvents(schema, "User-concurrent")).toHaveLength(1);
    } finally {
      await appendClient.query("ROLLBACK");
      await revokeClient.query("ROLLBACK");
      appendClient.release();
      revokeClient.release();
    }
  });
});
