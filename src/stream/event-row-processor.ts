import type { PoolClient } from "pg";

import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import {
  decryptFields,
  type EncryptedFieldEntry,
} from "../crypto/field-encryptor";
import { CryptoKeyNotFoundError } from "../errors";
import type {
  CloudEventExtensions,
  ReplayedEvent,
  StoredEvent,
  TombstonedEvent,
} from "../types";
import type { UpcasterRegistry } from "../upcaster/upcaster-registry";

export interface EventRow {
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

export function buildBaseContext(row: EventRow): BaseEventContext {
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
    encryptedData: row.encrypted_data as Record<string, EncryptedFieldEntry>,
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

export async function processRow<T>(options: {
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
