import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import {
  CryptoKeyNotFoundError,
  CryptoKeyRevokedError,
  MasterKeyRequiredError,
} from "../errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Manages per-entity AES-256 encryption keys using envelope encryption.
 *
 * Each entity (e.g. a user) gets its own AES key, which is stored encrypted
 * by the master key. Revoking an entity's key makes their PII unreadable
 * without touching any other entity's data.
 */
export class CryptoKeyManager {
  private readonly masterKey: Buffer;

  constructor(masterEncryptionKey: string) {
    if (!masterEncryptionKey) {
      throw new MasterKeyRequiredError();
    }
    this.masterKey = Buffer.from(masterEncryptionKey, "hex");
    if (this.masterKey.length !== KEY_LENGTH) {
      throw new Error(
        `Master encryption key must be 256 bits (64 hex chars), got ${masterEncryptionKey.length} hex chars`,
      );
    }
  }

  /**
   * Creates a new per-entity encryption key and stores it encrypted in the database.
   * If a key with this ID already exists (and is not revoked), this is a no-op.
   */
  async createKey(
    client: PoolClient,
    schema: string,
    keyId: string,
  ): Promise<void> {
    const entityKey = randomBytes(KEY_LENGTH);
    const encryptedKey = this.encryptWithMasterKey(entityKey);

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
  async getKey(
    client: PoolClient,
    schema: string,
    keyId: string,
  ): Promise<Buffer | null> {
    const result = await client.query<{
      encrypted_key: Buffer;
      revoked_at: Date | null;
    }>(
      `SELECT encrypted_key, revoked_at FROM ${schema}.crypto_keys WHERE key_id = $1`,
      [keyId],
    );

    if (result.rows.length === 0) {
      throw new CryptoKeyNotFoundError(keyId);
    }

    const row = result.rows[0];

    // Revoked keys return null — the caller should produce a tombstone
    if (row.revoked_at !== null) {
      return null;
    }

    return this.decryptWithMasterKey(row.encrypted_key);
  }

  /**
   * Retrieves the key for writing (append) operations.
   * Unlike getKey(), this throws if the key is revoked — you cannot
   * encrypt new events with a revoked key.
   */
  async getKeyForEncryption(
    client: PoolClient,
    schema: string,
    keyId: string,
  ): Promise<Buffer> {
    const key = await this.getKey(client, schema, keyId);
    if (key === null) {
      throw new CryptoKeyRevokedError(keyId);
    }
    return key;
  }

  /**
   * Revokes a crypto key by setting revoked_at.
   * Events encrypted with this key will be returned as tombstones on read.
   * The key is NOT deleted — this is intentional for audit trails.
   */
  async revokeKey(
    client: PoolClient,
    schema: string,
    keyId: string,
  ): Promise<void> {
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

  // --- Envelope encryption helpers ---

  private encryptWithMasterKey(entityKey: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const encrypted = Buffer.concat([cipher.update(entityKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: [iv (12 bytes)][authTag (16 bytes)][ciphertext]
    return Buffer.concat([iv, authTag, encrypted]);
  }

  private decryptWithMasterKey(encryptedKey: Buffer): Buffer {
    const iv = encryptedKey.subarray(0, IV_LENGTH);
    const authTag = encryptedKey.subarray(
      IV_LENGTH,
      IV_LENGTH + AUTH_TAG_LENGTH,
    );
    const ciphertext = encryptedKey.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
