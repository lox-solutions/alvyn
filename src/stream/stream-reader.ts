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
  id: string;
  source: string;
  specversion: string;
  event_type: string;
  subject: string;
  time: Date;
  datacontenttype: string;
  data: unknown;
  extensions: unknown;
  encrypted_data: unknown;
  crypto_key_id: string | null;
  schema_version: number;
  created_at: Date;
}

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

interface BaseEventContext {
  id: string;
  source: string;
  specversion: string;
  type: string;
  subject: string;
  time: string;
  datacontenttype: string;
  extensions: CloudEventExtensions;
  globalPosition: bigint;
  streamId: string;
  streamVersion: number;
  createdAt: Date;
}

function buildBaseContext(row: EventRow): BaseEventContext {
  return {
    id: row.id,
    source: row.source,
    specversion: row.specversion,
    type: row.event_type,
    subject: row.subject,
    time: row.time.toISOString(),
    datacontenttype: row.datacontenttype,
    extensions: (row.extensions ?? {}) as CloudEventExtensions,
    globalPosition: BigInt(row.global_position),
    streamId: row.stream_id,
    streamVersion: row.stream_version,
    createdAt: row.created_at,
  };
}

function buildTombstone(ctx: BaseEventContext): TombstonedEvent {
  return { ...ctx, data: null, tombstoned: true };
}

function applyUpcasters(options: {
  registry: UpcasterRegistry | null;
  eventType: string;
  schemaVersion: number;
  data: unknown;
}): unknown {
  if (!options.registry) return options.data;
  return options.registry.upcast({
    eventType: options.eventType,
    storedSchemaVersion: options.schemaVersion,
    data: options.data,
  });
}

async function resolveDecryptionKey(options: {
  cryptoKeyManager: CryptoKeyManager;
  keyCache: Map<string, Buffer | null>;
  client: PoolClient;
  schema: string;
  cryptoKeyId: string;
}): Promise<Buffer | null> {
  const { cryptoKeyManager, keyCache, client, schema, cryptoKeyId } = options;
  if (keyCache.has(cryptoKeyId)) return keyCache.get(cryptoKeyId) ?? null;

  let aesKey: Buffer | null;
  try {
    aesKey = await cryptoKeyManager.getKey({
      client,
      schema,
      keyId: cryptoKeyId,
    });
  } catch (error) {
    if (error instanceof CryptoKeyNotFoundError) {
      aesKey = null;
    } else {
      throw error;
    }
  }
  keyCache.set(cryptoKeyId, aesKey);
  return aesKey;
}

function processEncryptedRow<T>(options: {
  row: EventRow;
  ctx: BaseEventContext;
  aesKey: Buffer;
  upcasterRegistry: UpcasterRegistry | null;
}): StoredEvent<T> {
  const { row, ctx, aesKey, upcasterRegistry } = options;
  const decryptedData = decryptFields({
    cleanData: row.data as Record<string, unknown>,
    encryptedData: row.encrypted_data as Record<
      string,
      { ciphertext: string; iv: string; authTag: string }
    >,
    aesKey,
  });
  const finalData = applyUpcasters({
    registry: upcasterRegistry,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    data: decryptedData,
  });
  return { ...ctx, data: finalData as T };
}

function processPlainRow<T>(options: {
  row: EventRow;
  ctx: BaseEventContext;
  upcasterRegistry: UpcasterRegistry | null;
}): StoredEvent<T> {
  const finalData = applyUpcasters({
    registry: options.upcasterRegistry,
    eventType: options.row.event_type,
    schemaVersion: options.row.schema_version,
    data: options.row.data,
  });
  return { ...options.ctx, data: finalData as T };
}

async function processRow<T>(options: {
  row: EventRow;
  ctx: BaseEventContext;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry | null;
  keyCache: Map<string, Buffer | null>;
  client: PoolClient;
  schema: string;
}): Promise<ReplayedEvent<T>> {
  const {
    row,
    ctx,
    cryptoKeyManager,
    upcasterRegistry,
    keyCache,
    client,
    schema,
  } = options;

  if (!row.encrypted_data || !row.crypto_key_id) {
    return processPlainRow<T>({ row, ctx, upcasterRegistry });
  }
  if (!cryptoKeyManager) return buildTombstone(ctx);

  const aesKey = await resolveDecryptionKey({
    cryptoKeyManager,
    keyCache,
    client,
    schema,
    cryptoKeyId: row.crypto_key_id,
  });
  if (aesKey === null) return buildTombstone(ctx);

  return processEncryptedRow<T>({ row, ctx, aesKey, upcasterRegistry });
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
