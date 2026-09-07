import type { PoolClient } from "pg";
import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import { OptimisticConcurrencyError } from "../errors";
import type { AppendEventInput, AppendResult } from "../types";
import {
  assertNoReservedSnapshotEventTypes,
  assertOnlyReservedSnapshotEventTypes,
} from "../snapshot/reserved-event-type";
import { buildOutboxRows, insertOutboxChunks } from "./outbox-insert";
import { notifyChannel } from "./notify-channel";
import { prepareEventRow } from "./prepare-event-row";
import type { PreparedRow } from "./prepare-event-row";
import {
  checkIdempotencyKey,
  computeRequestHash,
  recordIdempotencyKey,
} from "./idempotency";

const PG_MAX_PARAMS = 65535;
const PARAMS_PER_EVENT = 14;
const MAX_EVENTS_PER_CHUNK = Math.floor(PG_MAX_PARAMS / PARAMS_PER_EVENT);

export interface AppendToStreamOptions {
  client: PoolClient;
  schema: string;
  input: {
    streamId: string;
    expectedVersion: number;
    events: AppendEventInput[];
    outboxTopics?: string[];
    defaultSource?: string;
    idempotencyKey?: string;
  };
  cryptoKeyManager: CryptoKeyManager | null;
  allowReservedEventTypes?: boolean;
}

async function acquireStreamLock(
  client: PoolClient,
  streamId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 1936024421))`,
    [streamId],
  );
}

async function validateVersion(options: {
  client: PoolClient;
  schema: string;
  streamId: string;
  expectedVersion: number;
}): Promise<number> {
  const { client, schema, streamId, expectedVersion } = options;
  const versionResult = await client.query<{ max_version: number | null }>(
    `SELECT MAX(stream_version) as max_version FROM ${schema}.events WHERE stream_id = $1`,
    [streamId],
  );
  const currentVersion = versionResult.rows[0]?.max_version ?? 0;
  if (expectedVersion === -1 && currentVersion > 0) {
    throw new OptimisticConcurrencyError(
      streamId,
      expectedVersion,
      currentVersion,
    );
  }
  if (expectedVersion > 0 && currentVersion !== expectedVersion) {
    throw new OptimisticConcurrencyError(
      streamId,
      expectedVersion,
      currentVersion,
    );
  }
  return currentVersion;
}

function buildChunkQuery(options: { chunk: PreparedRow[]; streamId: string }): {
  placeholders: string[];
  params: (string | number | null)[];
} {
  const { chunk, streamId } = options;
  const placeholders: string[] = [];
  const params: (string | number | null)[] = [];
  let paramIdx = 1;
  for (const row of chunk) {
    const indices = Array.from(
      { length: PARAMS_PER_EVENT },
      (_, i) => `$${paramIdx + i}`,
    );
    placeholders.push(`(${indices.join(", ")})`);
    params.push(
      streamId,
      row.version,
      row.id,
      row.source,
      row.specversion,
      row.eventType,
      row.subject,
      row.time,
      row.datacontenttype,
      row.dataJson,
      row.extensionsJson,
      row.encryptedDataJson,
      row.cryptoKeyId,
      row.schemaVersion,
    );
    paramIdx += PARAMS_PER_EVENT;
  }
  return { placeholders, params };
}

async function insertEventChunks(options: {
  client: PoolClient;
  schema: string;
  streamId: string;
  preparedRows: PreparedRow[];
}): Promise<bigint[]> {
  const { client, schema, streamId, preparedRows } = options;
  const globalPositions: bigint[] = [];
  for (
    let chunkStart = 0;
    chunkStart < preparedRows.length;
    chunkStart += MAX_EVENTS_PER_CHUNK
  ) {
    const chunk = preparedRows.slice(
      chunkStart,
      chunkStart + MAX_EVENTS_PER_CHUNK,
    );
    const { placeholders, params } = buildChunkQuery({ chunk, streamId });
    const insertResult = await client.query<{ global_position: string }>(
      `INSERT INTO ${schema}.events
        (stream_id, stream_version, id, source, specversion, event_type, subject, time, datacontenttype, data, extensions, encrypted_data, crypto_key_id, schema_version)
       VALUES ${placeholders.join(", ")} RETURNING global_position`,
      params,
    );
    for (const r of insertResult.rows)
      globalPositions.push(BigInt(r.global_position));
  }
  return globalPositions;
}

async function prepareRows(options: {
  events: AppendEventInput[];
  streamId: string;
  fromVersion: number;
  defaultSource: string;
  cryptoKeyManager: CryptoKeyManager | null;
  client: PoolClient;
  schema: string;
}): Promise<PreparedRow[]> {
  const { events, streamId, fromVersion, defaultSource } = options;
  const preparedRows: PreparedRow[] = [];
  for (let i = 0; i < events.length; i++) {
    preparedRows.push(
      await prepareEventRow({
        event: events[i],
        streamId,
        version: fromVersion + i,
        defaultSource,
        cryptoKeyManager: options.cryptoKeyManager,
        client: options.client,
        schema: options.schema,
      }),
    );
  }
  return preparedRows;
}

/** Collects the distinct per-entity keys needed by encrypted events. */
function encryptionKeyIds(events: AppendEventInput[]): string[] {
  return [
    ...new Set(
      events.flatMap((event) =>
        event.encryptedFields?.length && event.cryptoKeyId
          ? [event.cryptoKeyId]
          : [],
      ),
    ),
  ];
}

/** Locks encrypted-event keys before preparing rows in the append transaction. */
async function lockEncryptionKeys(options: {
  events: AppendEventInput[];
  cryptoKeyManager: CryptoKeyManager | null;
  client: PoolClient;
  schema: string;
}): Promise<void> {
  if (!options.cryptoKeyManager) return;
  await options.cryptoKeyManager.lockKeysForEncryption({
    client: options.client,
    schema: options.schema,
    keyIds: encryptionKeyIds(options.events),
  });
}

async function writeOutbox(options: {
  client: PoolClient;
  schema: string;
  preparedRows: PreparedRow[];
  globalPositions: bigint[];
  outboxTopics?: string[];
}): Promise<void> {
  const { client, schema, preparedRows, globalPositions, outboxTopics } =
    options;
  if (!outboxTopics || outboxTopics.length === 0) return;
  const rows = buildOutboxRows({ preparedRows, globalPositions, outboxTopics });
  await insertOutboxChunks({ client, schema, rows });
}

async function persistAppend(options: {
  client: PoolClient;
  schema: string;
  streamId: string;
  fromVersion: number;
  preparedRows: PreparedRow[];
  outboxTopics?: string[];
  idempotencyKey?: string;
  requestHash?: string;
}): Promise<AppendResult> {
  const {
    client,
    schema,
    streamId,
    fromVersion,
    preparedRows,
    outboxTopics,
    idempotencyKey,
    requestHash,
  } = options;
  const globalPositions = await insertEventChunks({
    client,
    schema,
    streamId,
    preparedRows,
  });
  await writeOutbox({
    client,
    schema,
    preparedRows,
    globalPositions,
    outboxTopics,
  });
  const toVersion = fromVersion + preparedRows.length - 1;
  if (idempotencyKey !== undefined && requestHash !== undefined) {
    await recordIdempotencyKey({
      client,
      schema,
      idempotencyKey,
      streamId,
      requestHash,
      fromVersion,
      toVersion,
      globalPositions,
    });
  }
  await client.query(`SELECT pg_notify($1, '')`, [notifyChannel(schema)]);
  return { streamId, fromVersion, toVersion, globalPositions, isDuplicate: false };
}

async function checkExistingIdempotency(options: {
  client: PoolClient;
  schema: string;
  idempotencyKey?: string;
  streamId: string;
  events: AppendEventInput[];
}): Promise<{ existing: AppendResult | null; requestHash?: string }> {
  const { client, schema, idempotencyKey, streamId, events } = options;
  if (idempotencyKey === undefined) return { existing: null };
  const requestHash = computeRequestHash(events);
  const existing = await checkIdempotencyKey({
    client,
    schema,
    idempotencyKey,
    streamId,
    requestHash,
  });
  return { existing, requestHash };
}

/** Appends events to a stream. CloudEvents v1.0.2 compliant. */
export async function appendToStream(
  options: AppendToStreamOptions,
): Promise<AppendResult> {
  const { client, schema, input, cryptoKeyManager, allowReservedEventTypes } =
    options;
  const { streamId, expectedVersion, events, outboxTopics, idempotencyKey } =
    input;
  const defaultSource = input.defaultSource ?? "event-store";
  if (events.length === 0) throw new Error("Cannot append zero events");
  if (allowReservedEventTypes) assertOnlyReservedSnapshotEventTypes(events);
  else assertNoReservedSnapshotEventTypes(events);

  await acquireStreamLock(client, streamId);

  const { existing, requestHash } = await checkExistingIdempotency({
    client,
    schema,
    idempotencyKey,
    streamId,
    events,
  });
  if (existing) return existing;

  const currentVersion = await validateVersion({
    client,
    schema,
    streamId,
    expectedVersion,
  });
  const fromVersion = currentVersion + 1;
  await lockEncryptionKeys({ events, cryptoKeyManager, client, schema });
  const preparedRows = await prepareRows({
    events,
    streamId,
    fromVersion,
    defaultSource,
    cryptoKeyManager,
    client,
    schema,
  });

  return persistAppend({
    client,
    schema,
    streamId,
    fromVersion,
    preparedRows,
    outboxTopics,
    idempotencyKey,
    requestHash,
  });
}
