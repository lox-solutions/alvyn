import type { PoolClient } from "pg";

import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import type { ReplayedEvent } from "../types";
import type { UpcasterRegistry } from "../upcaster/upcaster-registry";
import {
  buildBaseContext,
  processRow,
  type EventRow,
} from "./event-row-processor";

export interface ReadStreamOptions {
  client: PoolClient;
  schema: string;
  streamId: string;
  fromVersion: number;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry | null;
  maxEvents?: number;
}

export interface ReadLatestEventByTypeOptions {
  client: PoolClient;
  schema: string;
  streamId: string;
  eventType: string;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry | null;
}

/** Reads events for a stream. Handles decryption + upcasting. */
export async function readStream<T = unknown>(
  options: ReadStreamOptions,
): Promise<ReplayedEvent<T>[]> {
  const {
    client,
    schema,
    streamId,
    fromVersion,
    cryptoKeyManager,
    upcasterRegistry,
    maxEvents,
  } = options;

  const query =
    maxEvents !== undefined
      ? `SELECT global_position, stream_id, stream_version, id, source, specversion, event_type,
              subject, time, datacontenttype, data, extensions, encrypted_data, crypto_key_id, schema_version, created_at
       FROM ${schema}.events WHERE stream_id = $1 AND stream_version >= $2 ORDER BY stream_version ASC LIMIT $3`
      : `SELECT global_position, stream_id, stream_version, id, source, specversion, event_type,
              subject, time, datacontenttype, data, extensions, encrypted_data, crypto_key_id, schema_version, created_at
       FROM ${schema}.events WHERE stream_id = $1 AND stream_version >= $2 ORDER BY stream_version ASC`;

  const params: (string | number)[] = [streamId, fromVersion];
  if (maxEvents !== undefined) params.push(maxEvents);

  const result = await client.query<EventRow>(query, params);
  const events: ReplayedEvent<T>[] = [];
  const keyCache = new Map<string, Buffer | null>();

  for (const row of result.rows) {
    const ctx = buildBaseContext(row);
    events.push(
      await processRow<T>({
        row,
        ctx,
        cryptoKeyManager,
        upcasterRegistry,
        keyCache,
        client,
        schema,
      }),
    );
  }
  return events;
}

/** Reads the latest event of a specific type for a stream. Handles decryption + upcasting. */
export async function readLatestEventByType<T = unknown>(
  options: ReadLatestEventByTypeOptions,
): Promise<ReplayedEvent<T> | null> {
  const {
    client,
    schema,
    streamId,
    eventType,
    cryptoKeyManager,
    upcasterRegistry,
  } = options;
  const result = await client.query<EventRow>(
    `SELECT global_position, stream_id, stream_version, id, source, specversion, event_type,
            subject, time, datacontenttype, data, extensions, encrypted_data, crypto_key_id, schema_version, created_at
     FROM ${schema}.events WHERE stream_id = $1 AND event_type = $2 ORDER BY stream_version DESC LIMIT 1`,
    [streamId, eventType],
  );
  const row = result.rows[0];
  if (!row) return null;

  return processRow<T>({
    row,
    ctx: buildBaseContext(row),
    cryptoKeyManager,
    upcasterRegistry,
    keyCache: new Map<string, Buffer | null>(),
    client,
    schema,
  });
}

const DEFAULT_LIST_STREAMS_LIMIT = 100;

/** Lists distinct stream IDs, optionally filtered by prefix. */
export async function listStreams(options: {
  client: PoolClient;
  schema: string;
  prefix?: string;
  limit?: number;
}): Promise<string[]> {
  const { client, schema, prefix, limit } = options;
  const effectiveLimit = limit ?? DEFAULT_LIST_STREAMS_LIMIT;

  if (prefix) {
    const result = await client.query<{ stream_id: string }>(
      `SELECT DISTINCT stream_id FROM ${schema}.events WHERE stream_id LIKE $1 ORDER BY stream_id DESC LIMIT $2`,
      [`${prefix}-%`, effectiveLimit],
    );
    return result.rows.map((row) => row.stream_id);
  }

  const result = await client.query<{ stream_id: string }>(
    `SELECT DISTINCT stream_id FROM ${schema}.events ORDER BY stream_id DESC LIMIT $1`,
    [effectiveLimit],
  );
  return result.rows.map((row) => row.stream_id);
}
