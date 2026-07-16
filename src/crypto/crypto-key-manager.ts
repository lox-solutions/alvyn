import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { PoolClient } from "pg";

import {
  CryptoSecretVersionNotFoundError,
  CryptoKeyNotFoundError,
  CryptoKeyRevokedError,
} from "../errors";
import { validateCryptoSecrets } from "./crypto-secrets";
import type { CryptoSecret } from "../types";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const ENVELOPE_MAGIC = Buffer.from("ALVY");
const SECRET_VERSION_OFFSET = ENVELOPE_MAGIC.length;
const SECRET_VERSION_BYTE_LENGTH = 4;
const ENVELOPE_HEADER_LENGTH =
  SECRET_VERSION_OFFSET + SECRET_VERSION_BYTE_LENGTH;
const ENVELOPE_LENGTH =
  ENVELOPE_HEADER_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + KEY_LENGTH;

export interface CryptoKeyManagerOptions {
  /** Ordered secrets; the first one is used for new encryption. */
  secrets: readonly CryptoSecret[];
}

export interface CryptoKeyOptions {
  client: PoolClient;
  schema: string;
  keyId: string;
}

/**
 * Manages per-entity AES-256 encryption keys using envelope encryption.
 *
 * Each entity (e.g. a user) gets its own AES key, which is stored encrypted
 * by a configured secret. Revoking an entity's key makes their PII unreadable
 * without touching any other entity's data.
 */
export class CryptoKeyManager {
  private readonly secretKeys: Map<number, Buffer>;
  public readonly currentSecretVersion: number;
  public readonly configuredSecretVersions: number[];

  constructor(config: CryptoKeyManagerOptions) {
    const secrets = validateCryptoSecrets(config.secrets);
    this.secretKeys = new Map(
      secrets.map((secret) => [secret.version, deriveSecretKey(secret.value)]),
    );
    this.currentSecretVersion = secrets[0].version;
    this.configuredSecretVersions = secrets.map((secret) => secret.version);
  }

  /**
   * Creates a new per-entity encryption key and stores it encrypted in the database.
   * If a key with this ID already exists (and is not revoked), this is a no-op.
   */
  async createKey(options: CryptoKeyOptions): Promise<void> {
    const { client, schema, keyId } = options;
    const entityKey = randomBytes(KEY_LENGTH);
    const encryptedKey = this.encryptWithCurrentSecret(entityKey, keyId);

    await client.query(
      `INSERT INTO ${schema}.crypto_keys (key_id, encrypted_key)
       VALUES ($1, $2)
       ON CONFLICT (key_id) DO NOTHING`,
      [keyId, encryptedKey],
    );
  }

  /**
   * Retrieves and decrypts the per-entity AES key.
   * Returns null if the key has been revoked (tombstone semantics).
   * Throws CryptoKeyNotFoundError if the key does not exist at all.
   */
  async getKey(options: CryptoKeyOptions): Promise<Buffer | null> {
    const stored = await this.getStoredKey(options);
    return stored?.key ?? null;
  }

  /**
   * Retrieves the key for writing (append) operations.
   * Unlike getKey(), this throws if the key is revoked — you cannot
   * encrypt new events with a revoked key.
   */
  async getKeyForEncryption(options: CryptoKeyOptions): Promise<Buffer> {
    const stored = await this.getStoredKey(options, true);
    if (stored === null) {
      throw new CryptoKeyRevokedError(options.keyId);
    }

    // Re-wrap older-version envelopes only when the entity is written.
    // Existing encrypted event data remains untouched.
    if (stored.version < this.currentSecretVersion) {
      await options.client.query(
        `UPDATE ${options.schema}.crypto_keys
         SET encrypted_key = $1
         WHERE key_id = $2 AND revoked_at IS NULL`,
        [
          this.encryptWithCurrentSecret(stored.key, options.keyId),
          options.keyId,
        ],
      );
    }
    return stored.key;
  }

  /**
   * Revokes a crypto key by setting revoked_at.
   * Events encrypted with this key will be returned as tombstones on read.
   * The key is NOT deleted — this is intentional for audit trails.
   */
  async revokeKey(options: CryptoKeyOptions): Promise<void> {
    const { client, schema, keyId } = options;
    const result = await client.query(
      `UPDATE ${schema}.crypto_keys SET revoked_at = now() WHERE key_id = $1 AND revoked_at IS NULL`,
      [keyId],
    );

    if (result.rowCount === 0) {
      // Check if key exists at all
      const exists = await client.query(
        `SELECT 1 FROM ${schema}.crypto_keys WHERE key_id = $1`,
        [keyId],
      );
      if (exists.rows.length === 0) {
        throw new CryptoKeyNotFoundError(keyId);
      }
      // Key exists but was already revoked — idempotent, no error
    }
  }

  private async getStoredKey(
    options: CryptoKeyOptions,
    lockForEncryption = false,
  ): Promise<{ key: Buffer; version: number } | null> {
    const { client, schema, keyId } = options;
    const result = await client.query<{
      encrypted_key: Buffer;
      revoked_at: Date | null;
    }>(
      `SELECT encrypted_key, revoked_at FROM ${schema}.crypto_keys WHERE key_id = $1${lockForEncryption ? " FOR UPDATE" : ""}`,
      [keyId],
    );

    if (result.rows.length === 0) {
      throw new CryptoKeyNotFoundError(keyId);
    }

    const row = result.rows[0];
    if (row.revoked_at !== null) return null;

    return this.decryptStoredKey(row.encrypted_key, keyId);
  }

  // --- Versioned envelope encryption helpers ---

  private encryptWithCurrentSecret(entityKey: Buffer, keyId: string): Buffer {
    const secretKey = this.secretKeys.get(this.currentSecretVersion)!;
    const iv = randomBytes(IV_LENGTH);
    const version = Buffer.alloc(SECRET_VERSION_BYTE_LENGTH);
    version.writeUInt32BE(this.currentSecretVersion, 0);
    const header = Buffer.concat([ENVELOPE_MAGIC, version]);
    const cipher = createCipheriv(ALGORITHM, secretKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(this.envelopeAad(header, keyId));
    const encrypted = Buffer.concat([cipher.update(entityKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: [magic (4 bytes)][key version (uint32)][iv][authTag][ciphertext]
    return Buffer.concat([header, iv, authTag, encrypted]);
  }

  private decryptStoredKey(
    encryptedKey: Buffer,
    keyId: string,
  ): {
    key: Buffer;
    version: number;
  } {
    if (
      !encryptedKey.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC) ||
      encryptedKey.length !== ENVELOPE_LENGTH
    ) {
      throw new Error("Invalid versioned crypto key envelope");
    }

    const version = encryptedKey.readUInt32BE(SECRET_VERSION_OFFSET);
    const secretKey = this.secretKeys.get(version);
    if (!secretKey) {
      throw new CryptoSecretVersionNotFoundError(version);
    }
    return {
      key: this.decryptWithSecret({
        encryptedKey,
        secretKey,
        offset: ENVELOPE_HEADER_LENGTH,
        keyId,
      }),
      version,
    };
  }

  private decryptWithSecret(options: {
    encryptedKey: Buffer;
    secretKey: Buffer;
    offset: number;
    keyId: string;
  }): Buffer {
    const { encryptedKey, secretKey, offset, keyId } = options;
    const iv = encryptedKey.subarray(offset, offset + IV_LENGTH);
    const authTag = encryptedKey.subarray(
      offset + IV_LENGTH,
      offset + IV_LENGTH + AUTH_TAG_LENGTH,
    );
    const ciphertext = encryptedKey.subarray(
      offset + IV_LENGTH + AUTH_TAG_LENGTH,
    );

    const decipher = createDecipheriv(ALGORITHM, secretKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(this.envelopeAad(encryptedKey.subarray(0, offset), keyId));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private envelopeAad(header: Buffer, keyId: string): Buffer {
    return Buffer.from(
      JSON.stringify([
        "alvyn:entity-key-envelope:v1",
        keyId,
        header.toString("base64"),
      ]),
      "utf8",
    );
  }
}

function deriveSecretKey(value: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  return createHash("sha256").update(value, "utf8").digest();
}
