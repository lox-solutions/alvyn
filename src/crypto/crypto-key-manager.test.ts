import { createDecipheriv, scryptSync } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestPool,
  startPostgres,
  stopPostgres,
  uniqueSchema,
} from "../__tests__/setup";
import {
  CryptoKeyNotFoundError,
  CryptoKeyRevokedError,
  CryptoSecretVersionNotFoundError,
} from "../errors";
import { EventStore } from "../event-store";
import type { CryptoSecretsConfig } from "../types";
import { CryptoKeyManager } from "./crypto-key-manager";

const SECRET_1 = "11".repeat(32);
const SECRET_2 = "22".repeat(32);
const SECRET_3 = "33".repeat(32);
const DEFAULT_SECRETS = [{ version: 1, value: SECRET_1 }] as const;

interface ManagerTestContext {
  client: pg.PoolClient;
  manager: CryptoKeyManager;
  schema: string;
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

async function withManager(
  test: (context: ManagerTestContext) => Promise<void>,
  config: CryptoSecretsConfig = {
    currentVersion: 1,
    secrets: DEFAULT_SECRETS,
  },
): Promise<void> {
  const schema = uniqueSchema();
  const store = new EventStore({
    pool,
    schema,
    secrets: {
      currentVersion: config.currentVersion,
      secrets: [...config.secrets],
    },
  });
  await store.setup();
  const client = await pool.connect();
  try {
    await test({
      client,
      manager: new CryptoKeyManager(config),
      schema,
    });
  } finally {
    client.release();
  }
}

async function readEnvelope(
  context: ManagerTestContext,
  keyId: string,
): Promise<Buffer> {
  const result = await context.client.query<{ encrypted_key: Buffer }>(
    `SELECT encrypted_key FROM ${context.schema}.crypto_keys WHERE key_id = $1`,
    [keyId],
  );
  return result.rows[0].encrypted_key;
}

async function writeEnvelope(options: {
  context: ManagerTestContext;
  keyId: string;
  envelope: Buffer;
}): Promise<void> {
  const { context, keyId, envelope } = options;
  await context.client.query(
    `UPDATE ${context.schema}.crypto_keys SET encrypted_key = $1 WHERE key_id = $2`,
    [envelope, keyId],
  );
}

function envelopeVersion(envelope: Buffer): number {
  return envelope.readUInt32BE(4);
}

function flipByte(value: Buffer, offset: number): Buffer {
  const changed = Buffer.from(value);
  changed[offset] ^= 1;
  return changed;
}

function decryptEnvelopeWithSecret(options: {
  envelope: Buffer;
  keyId: string;
  secretKey: Buffer;
}): Buffer {
  const { envelope, keyId, secretKey } = options;
  const header = envelope.subarray(0, 8);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secretKey,
    envelope.subarray(8, 20),
    { authTagLength: 16 },
  );
  decipher.setAAD(
    Buffer.from(
      JSON.stringify([
        "alvyn:entity-key-envelope:v1",
        keyId,
        header.toString("base64"),
      ]),
      "utf8",
    ),
  );
  decipher.setAuthTag(envelope.subarray(20, 36));
  return Buffer.concat([
    decipher.update(envelope.subarray(36)),
    decipher.final(),
  ]);
}

describe("entity crypto keys", () => {
  it("creates and decrypts a random 256-bit key", () =>
    withManager(async ({ client, manager, schema }) => {
      await manager.createKey({ client, schema, keyId: "user:1" });

      const key = await manager.getKey({ client, schema, keyId: "user:1" });

      expect(key).toBeInstanceOf(Buffer);
      expect(key).toHaveLength(32);
    }));

  it.each([
    ["passphrase", "a human-readable secret"],
    ["hex-looking value", SECRET_1],
  ])("uses scrypt for a %s secret", (_kind, secretValue) =>
    withManager(
      async ({ client, manager, schema }) => {
        const keyId = "user:scrypt";
        await manager.createKey({ client, schema, keyId });
        const envelope = await readEnvelope({ client, manager, schema }, keyId);

        expect(
          decryptEnvelopeWithSecret({
            envelope,
            keyId,
            secretKey: scryptSync(secretValue, "alvyn:crypto-secret:v1", 32),
          }),
        ).toHaveLength(32);
      },
      { currentVersion: 1, secrets: [{ version: 1, value: secretValue }] },
    ),
  );

  it("locks a batch of keys in deterministic key ID order", async () => {
    const queriedKeyIds: string[] = [];
    const client = {
      query: (_text: string, values: string[]) => {
        queriedKeyIds.push(values[0]);
        return { rows: [{ revoked_at: null }] };
      },
    } as unknown as pg.PoolClient;
    const manager = new CryptoKeyManager({
      currentVersion: 1,
      secrets: DEFAULT_SECRETS,
    });

    await manager.lockKeysForEncryption({
      client,
      schema: "test_schema",
      keyIds: ["user:z", "user:a", "user:z"],
    });

    expect(queriedKeyIds).toEqual(["user:a", "user:z"]);
  });

  it("throws when locking a key that does not exist", async () => {
    const client = {
      query: () => ({ rows: [] }),
    } as unknown as pg.PoolClient;
    const manager = new CryptoKeyManager({
      currentVersion: 1,
      secrets: DEFAULT_SECRETS,
    });

    await expect(
      manager.lockKeysForEncryption({
        client,
        schema: "test_schema",
        keyIds: ["missing"],
      }),
    ).rejects.toThrow(CryptoKeyNotFoundError);
  });

  it("keeps the original key when creation is repeated", () =>
    withManager(async (context) => {
      const options = {
        client: context.client,
        schema: context.schema,
        keyId: "user:idempotent",
      };
      await context.manager.createKey(options);
      const first = await context.manager.getKey(options);

      await context.manager.createKey(options);

      expect(await context.manager.getKey(options)).toEqual(first);
    }));

  it("throws when the key does not exist", () =>
    withManager(async ({ client, manager, schema }) => {
      await expect(
        manager.getKey({ client, schema, keyId: "missing" }),
      ).rejects.toThrow(CryptoKeyNotFoundError);
    }));

  it("rejects key rows with missing key material", () =>
    withManager(async ({ client, manager, schema }) => {
      const keyId = "user:missing-material";
      await manager.createKey({ client, schema, keyId });
      await client.query(
        `UPDATE ${schema}.crypto_keys SET encrypted_key = NULL WHERE key_id = $1`,
        [keyId],
      );

      await expect(manager.getKey({ client, schema, keyId })).rejects.toThrow(
        `Crypto key material is missing for key "${keyId}"`,
      );
    }));

  it("returns null after revocation and makes revocation idempotent", () =>
    withManager(async ({ client, manager, schema }) => {
      const options = { client, schema, keyId: "user:revoked" };
      await manager.createKey(options);

      await manager.revokeKey(options);
      await manager.revokeKey(options);

      await expect(manager.getKey(options)).resolves.toBeNull();
      await expect(manager.getKeyForEncryption(options)).rejects.toThrow(
        CryptoKeyRevokedError,
      );

      const result = await client.query<{
        key_id: string;
        encrypted_key: Buffer | null;
        revoked_at: Date | null;
        algorithm: string;
        created_at: Date;
      }>(
        `SELECT key_id, encrypted_key, revoked_at, algorithm, created_at
         FROM ${schema}.crypto_keys WHERE key_id = $1`,
        [options.keyId],
      );
      expect(result.rows[0]).toMatchObject({
        key_id: options.keyId,
        encrypted_key: null,
        algorithm: "aes-256-gcm",
      });
      expect(result.rows[0].revoked_at).toBeInstanceOf(Date);
      expect(result.rows[0].created_at).toBeInstanceOf(Date);
    }));

  it("cannot revoke a key that does not exist", () =>
    withManager(async ({ client, manager, schema }) => {
      await expect(
        manager.revokeKey({ client, schema, keyId: "missing" }),
      ).rejects.toThrow(CryptoKeyNotFoundError);
    }));
});

describe("entity key envelope", () => {
  it("stores the magic marker, secret version, IV, tag, and ciphertext", () =>
    withManager(async (context) => {
      await context.manager.createKey({
        client: context.client,
        schema: context.schema,
        keyId: "user:format",
      });

      const envelope = await readEnvelope(context, "user:format");

      expect(envelope.subarray(0, 4).toString("utf8")).toBe("ALVY");
      expect(envelopeVersion(envelope)).toBe(1);
      expect(envelope).toHaveLength(68);
    }));

  it("rejects unversioned entity key envelopes", () =>
    withManager(async (context) => {
      const keyId = "user:unversioned";
      await context.manager.createKey({
        client: context.client,
        schema: context.schema,
        keyId,
      });
      await writeEnvelope({
        context,
        keyId,
        envelope: Buffer.alloc(60),
      });

      await expect(
        context.manager.getKey({
          client: context.client,
          schema: context.schema,
          keyId,
        }),
      ).rejects.toThrow("Invalid versioned crypto key envelope");
    }));

  it("selects the secret directly by envelope version", () =>
    withManager(async (context) => {
      await context.manager.createKey({
        client: context.client,
        schema: context.schema,
        keyId: "user:unknown-version",
      });
      const envelope = await readEnvelope(context, "user:unknown-version");
      envelope.writeUInt32BE(99, 4);
      await writeEnvelope({
        context,
        keyId: "user:unknown-version",
        envelope,
      });

      await expect(
        context.manager.getKey({
          client: context.client,
          schema: context.schema,
          keyId: "user:unknown-version",
        }),
      ).rejects.toThrow(CryptoSecretVersionNotFoundError);
    }));

  it("authenticates the secret version even when both versions use the same value", () =>
    withManager(
      async (context) => {
        const options = {
          client: context.client,
          schema: context.schema,
          keyId: "user:header",
        };
        await context.manager.createKey(options);
        const envelope = await readEnvelope(context, options.keyId);
        envelope.writeUInt32BE(1, 4);
        await writeEnvelope({ context, keyId: options.keyId, envelope });

        await expect(context.manager.getKey(options)).rejects.toThrow();
      },
      {
        currentVersion: 2,
        secrets: [
          { version: 2, value: SECRET_2 },
          { version: 1, value: SECRET_2 },
        ],
      },
    ));

  it("binds an envelope to its key ID", () =>
    withManager(async (context) => {
      await context.manager.createKey({
        client: context.client,
        schema: context.schema,
        keyId: "user:first",
      });
      await context.manager.createKey({
        client: context.client,
        schema: context.schema,
        keyId: "user:second",
      });
      await writeEnvelope({
        context,
        keyId: "user:second",
        envelope: await readEnvelope(context, "user:first"),
      });

      await expect(
        context.manager.getKey({
          client: context.client,
          schema: context.schema,
          keyId: "user:second",
        }),
      ).rejects.toThrow();
    }));

  it("rejects a secret with the right version but wrong value", () =>
    withManager(async (context) => {
      const options = {
        client: context.client,
        schema: context.schema,
        keyId: "user:wrong-secret",
      };
      await context.manager.createKey(options);
      const wrongManager = new CryptoKeyManager({
        currentVersion: 1,
        secrets: [{ version: 1, value: SECRET_2 }],
      });

      await expect(wrongManager.getKey(options)).rejects.toThrow();
    }));

  it.each([
    ["magic marker", (value: Buffer) => flipByte(value, 0)],
    ["IV", (value: Buffer) => flipByte(value, 8)],
    ["authentication tag", (value: Buffer) => flipByte(value, 20)],
    ["ciphertext", (value: Buffer) => flipByte(value, 36)],
    ["truncation", (value: Buffer) => value.subarray(0, value.length - 1)],
    ["trailing bytes", (value: Buffer) => Buffer.concat([value, Buffer.of(0)])],
  ])("rejects envelope %s tampering", (_part, tamper) =>
    withManager(async (context) => {
      const options = {
        client: context.client,
        schema: context.schema,
        keyId: `user:tampered:${_part}`,
      };
      await context.manager.createKey(options);
      await writeEnvelope({
        context,
        keyId: options.keyId,
        envelope: tamper(await readEnvelope(context, options.keyId)),
      });

      await expect(context.manager.getKey(options)).rejects.toThrow();
    }),
  );
});

describe("secret rotation", () => {
  it("does not rewrite an old envelope during reads", () =>
    withManager(async (context) => {
      const options = {
        client: context.client,
        schema: context.schema,
        keyId: "user:read-only",
      };
      await context.manager.createKey(options);
      const before = await readEnvelope(context, options.keyId);
      const rotated = new CryptoKeyManager({
        currentVersion: 3,
        secrets: [
          { version: 3, value: SECRET_3 },
          { version: 1, value: SECRET_1 },
        ],
      });

      await rotated.getKey(options);

      expect(await readEnvelope(context, options.keyId)).toEqual(before);
    }));

  it("rewraps with a newer secret on the next write without changing the entity key", () =>
    withManager(async (context) => {
      const options = {
        client: context.client,
        schema: context.schema,
        keyId: "user:rotate",
      };
      await context.manager.createKey(options);
      const originalKey = await context.manager.getKey(options);
      const rotated = new CryptoKeyManager({
        currentVersion: 3,
        secrets: [
          { version: 3, value: SECRET_3 },
          { version: 1, value: SECRET_1 },
        ],
      });

      expect(await rotated.getKeyForEncryption(options)).toEqual(originalKey);

      expect(envelopeVersion(await readEnvelope(context, options.keyId))).toBe(
        3,
      );
      const newOnly = new CryptoKeyManager({
        currentVersion: 3,
        secrets: [{ version: 3, value: SECRET_3 }],
      });
      await expect(newOnly.getKey(options)).resolves.toEqual(originalKey);
    }));

  it("never downgrades a newer envelope from an older replica", () =>
    withManager(
      async (context) => {
        const options = {
          client: context.client,
          schema: context.schema,
          keyId: "user:no-downgrade",
        };
        await context.manager.createKey(options);
        const before = await readEnvelope(context, options.keyId);
        const olderReplica = new CryptoKeyManager({
          currentVersion: 1,
          secrets: [
            { version: 1, value: SECRET_1 },
            { version: 3, value: SECRET_3 },
          ],
        });

        await olderReplica.getKeyForEncryption(options);

        expect(await readEnvelope(context, options.keyId)).toEqual(before);
      },
      {
        currentVersion: 3,
        secrets: [
          { version: 3, value: SECRET_3 },
          { version: 1, value: SECRET_1 },
        ],
      },
    ));
});

describe("revocation concurrency across replicas", () => {
  it("makes revocation wait for an in-flight encryption transaction", () =>
    withManager(async (context) => {
      const options = {
        client: context.client,
        schema: context.schema,
        keyId: "user:append-first",
      };
      await context.manager.createKey(options);
      const revokeClient = await pool.connect();
      try {
        await context.client.query("BEGIN");
        await context.manager.getKeyForEncryption(options);
        await revokeClient.query("BEGIN");
        await revokeClient.query("SET LOCAL lock_timeout = '50ms'");

        await expect(
          context.manager.revokeKey({ ...options, client: revokeClient }),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        await context.client.query("ROLLBACK");
        await revokeClient.query("ROLLBACK");
        revokeClient.release();
      }
    }));

  it("prevents encryption after a concurrent revocation commits", () =>
    withManager(async (context) => {
      const options = {
        client: context.client,
        schema: context.schema,
        keyId: "user:revoke-first",
      };
      await context.manager.createKey(options);
      const appendClient = await pool.connect();
      try {
        await context.client.query("BEGIN");
        await context.manager.revokeKey(options);
        await appendClient.query("BEGIN");
        await appendClient.query("SET LOCAL lock_timeout = '50ms'");

        await expect(
          context.manager.getKeyForEncryption({
            ...options,
            client: appendClient,
          }),
        ).rejects.toMatchObject({ code: "55P03" });
        await appendClient.query("ROLLBACK");
        await context.client.query("COMMIT");

        await expect(
          context.manager.getKeyForEncryption(options),
        ).rejects.toThrow(CryptoKeyRevokedError);
      } finally {
        await context.client.query("ROLLBACK");
        await appendClient.query("ROLLBACK");
        appendClient.release();
      }
    }));
});
