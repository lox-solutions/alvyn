import type { PoolClient } from "pg";

import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import { decryptFields } from "../crypto/field-encryptor";
import { CryptoKeyNotFoundError } from "../errors";
import type {
  CloudEventExtensions,
  ReplayedEvent,
  StoredEvent,
  TombstonedEvent,
} from "../types";
import type { UpcasterRegistry } from "../upcaster/upcaster-registry";

interface EventRow {
  global_position: string;
  stream_id: string;
  stream_version: number;
  // CloudEvents REQUIRED
  id: string;
  source: string;
  specversion: string;
  event_type: string;
  // CloudEvents OPTIONAL
  subject: string;
  time: Date;
  datacontenttype: string;
  // Data & extensions
  data: unknown;
  extensions: unknown;
  // Crypto
  encrypted_data: unknown;
  crypto_key_id: string | null;
  schema_version: number;
  created_at: Date;
}

/**
 * Reads all events for a stream, starting from a given version.
 * Handles decryption (producing tombstones for revoked keys) and upcasting.
 *
 * Returns CloudEvents v1.0.2 compliant StoredEvent objects.
 *
 * @param maxEvents - Optional limit on the number of events to read.
 *   Defaults to undefined (no limit). Set this to prevent unbounded memory
 *   usage for streams with very large event counts.
 */
export async function readStream<T = unknown>(
  client: PoolClient,
  schema: string,
  streamId: string,
  fromVersion: number,
  cryptoKeyManager: CryptoKeyManager | null,
  upcasterRegistry: UpcasterRegistry | null,
  maxEvents?: number,
): Promise<ReplayedEvent<T>[]> {
  const query =
    maxEvents !== undefined
      ? `SELECT global_position, stream_id, stream_version,
                id, source, specversion, event_type,
                subject, time, datacontenttype,
                data, extensions, encrypted_data, crypto_key_id, schema_version, created_at
         FROM ${schema}.events
         WHERE stream_id = $1 AND stream_version >= $2
         ORDER BY stream_version ASC
         LIMIT $3`
      : `SELECT global_position, stream_id, stream_version,
                id, source, specversion, event_type,
                subject, time, datacontenttype,
                data, extensions, encrypted_data, crypto_key_id, schema_version, created_at
         FROM ${schema}.events
         WHERE stream_id = $1 AND stream_version >= $2
         ORDER BY stream_version ASC`;

  const params: (string | number)[] = [streamId, fromVersion];
  if (maxEvents !== undefined) {
    params.push(maxEvents);
  }

  const result = await client.query<EventRow>(query, params);

  const events: ReplayedEvent<T>[] = [];

  // Cache decrypted keys within this read operation to avoid redundant DB lookups.
  // This cache lives only for the duration of this function call (stateless across requests).
  const keyCache = new Map<string, Buffer | null>();

  for (const row of result.rows) {
    const extensions = (row.extensions ?? {}) as CloudEventExtensions;
    const globalPosition = BigInt(row.global_position);

    // Build base CloudEvents context (shared by both normal and tombstoned events)
    const baseContext = {
      id: row.id,
      source: row.source,
      specversion: row.specversion,
      type: row.event_type,
      subject: row.subject,
      time: row.time.toISOString(),
      datacontenttype: row.datacontenttype,
      extensions,
      globalPosition,
      streamId: row.stream_id,
      streamVersion: row.stream_version,
      createdAt: row.created_at,
    };

    // Handle encrypted data
    if (row.encrypted_data && row.crypto_key_id) {
      if (!cryptoKeyManager) {
        // No crypto manager → treat as tombstone (can't decrypt)
        const tombstone: TombstonedEvent = {
          ...baseContext,
          data: null,
          tombstoned: true,
        };
        events.push(tombstone);
        continue;
      }

      // Try to get the decryption key (cached per-read)
      let aesKey: Buffer | null;
      if (keyCache.has(row.crypto_key_id)) {
        aesKey = keyCache.get(row.crypto_key_id)!;
      } else {
        try {
          aesKey = await cryptoKeyManager.getKey(
            client,
            schema,
            row.crypto_key_id,
          );
        } catch (error) {
          // Only treat CryptoKeyNotFoundError as a tombstone condition.
          // All other errors (DB failures, connection issues) must propagate
          // to avoid silent data loss on transient infrastructure failures.
          if (error instanceof CryptoKeyNotFoundError) {
            aesKey = null;
          } else {
            throw error;
          }
        }
        keyCache.set(row.crypto_key_id, aesKey);
      }

      if (aesKey === null) {
        // Key revoked or not found → tombstone
        const tombstone: TombstonedEvent = {
          ...baseContext,
          data: null,
          tombstoned: true,
        };
        events.push(tombstone);
        continue;
      }

      // Decrypt and merge
      const decryptedData = decryptFields(
        row.data as Record<string, unknown>,
        row.encrypted_data as Record<
          string,
          { ciphertext: string; iv: string; authTag: string }
        >,
        aesKey,
      );

      let finalData: unknown = decryptedData;

      // Apply upcasters
      if (upcasterRegistry) {
        finalData = upcasterRegistry.upcast(
          row.event_type,
          row.schema_version,
          finalData,
        );
      }

      const event: StoredEvent<T> = {
        ...baseContext,
        data: finalData as T,
      };
      events.push(event);
    } else {
      // No encryption — plain event
      let finalData: unknown = row.data;

      // Apply upcasters
      if (upcasterRegistry) {
        finalData = upcasterRegistry.upcast(
          row.event_type,
          row.schema_version,
          finalData,
        );
      }

      const event: StoredEvent<T> = {
        ...baseContext,
        data: finalData as T,
      };
      events.push(event);
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Stream Discovery
// ---------------------------------------------------------------------------

const DEFAULT_LIST_STREAMS_LIMIT = 100;

/**
 * Lists distinct stream IDs, optionally filtered by prefix.
 *
 * When a prefix is provided, uses a `LIKE 'Prefix-%'` pattern which is
 * efficiently served by the B-tree index on `(stream_id, stream_version)`.
 *
 * Results are ordered by stream_id descending (most recently created IDs
 * tend to sort last lexicographically, but this is not guaranteed for all
 * ID generation strategies).
 */
export async function listStreams(
  client: PoolClient,
  schema: string,
  prefix?: string,
  limit?: number,
): Promise<string[]> {
  const effectiveLimit = limit ?? DEFAULT_LIST_STREAMS_LIMIT;

  if (prefix) {
    const result = await client.query<{ stream_id: string }>(
      `SELECT DISTINCT stream_id
       FROM ${schema}.events
       WHERE stream_id LIKE $1
       ORDER BY stream_id DESC
       LIMIT $2`,
      [`${prefix}-%`, effectiveLimit],
    );
    return result.rows.map((row) => row.stream_id);
  }

  const result = await client.query<{ stream_id: string }>(
    `SELECT DISTINCT stream_id
     FROM ${schema}.events
     ORDER BY stream_id DESC
     LIMIT $1`,
    [effectiveLimit],
  );
  return result.rows.map((row) => row.stream_id);
}
