import type { PoolClient } from "pg";
import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import { OptimisticConcurrencyError } from "../errors";
import type { AppendEventInput, AppendResult } from "../types";
import { buildOutboxRows, insertOutboxChunks } from "./outbox-insert";
import { prepareEventRow } from "./prepare-event-row";
import type { PreparedRow } from "./prepare-event-row";

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
  };
  cryptoKeyManager: CryptoKeyManager | null;
}

async function acquireLockAndValidateVersion(options: {
  client: PoolClient;
  schema: string;
  streamId: string;
  expectedVersion: number;
}): Promise<number> {
  const { client, schema, streamId, expectedVersion } = options;
  await client.query(`SELECT pg_advisory_xact_lock(1936024421, hashtext($1))`, [
    streamId,
  ]);
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

/** Appends events to a stream. CloudEvents v1.0.2 compliant. */
export async function appendToStream(
  options: AppendToStreamOptions,
): Promise<AppendResult> {
  const { client, schema, input, cryptoKeyManager } = options;
  const { streamId, expectedVersion, events, outboxTopics } = input;
  const defaultSource = input.defaultSource ?? "event-store";
  if (events.length === 0) throw new Error("Cannot append zero events");

  const currentVersion = await acquireLockAndValidateVersion({
    client,
    schema,
    streamId,
    expectedVersion,
  });
  const fromVersion = currentVersion + 1;
  const preparedRows: PreparedRow[] = [];
  for (let i = 0; i < events.length; i++) {
    preparedRows.push(
      await prepareEventRow({
        event: events[i],
        streamId,
        version: fromVersion + i,
        defaultSource,
        cryptoKeyManager,
        client,
        schema,
      }),
    );
  }
  const globalPositions = await insertEventChunks({
    client,
    schema,
    streamId,
    preparedRows,
  });

  if (outboxTopics && outboxTopics.length > 0) {
    const outboxRows = buildOutboxRows({
      preparedRows,
      globalPositions,
      outboxTopics,
    });
    await insertOutboxChunks({ client, schema, rows: outboxRows });
  }

  return {
    streamId,
    fromVersion,
    toVersion: fromVersion + events.length - 1,
    globalPositions,
  };
}
