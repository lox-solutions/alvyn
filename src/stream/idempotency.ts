import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { IdempotencyConflictError } from "../errors";
import { assertValidSchemaName } from "../sql-helpers";
import type { AppendResult } from "../types";

const DEFAULT_CLEANUP_BATCH_SIZE = 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MS_PER_SECOND = 1000;

interface IdempotencyKeyRow {
  stream_id: string;
  request_hash: string;
  from_version: number;
  to_version: number;
  global_positions: (string | number | bigint)[];
}

export interface RequestHashPayload {
  events: readonly unknown[];
  outboxTopics?: readonly string[];
}

/**
 * Deterministically serializes a value by recursively sorting object keys.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort((a, b) => a.localeCompare(b))
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (val as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return val;
  });
}

/**
 * Computes a deterministic SHA-256 hash representing the event batch payload
 * and any associated append configuration (such as outbox topics).
 */
export function computeRequestHash(
  payload: RequestHashPayload | readonly unknown[],
): string {
  if ("events" in payload) {
    const events = payload.events;
    const outboxTopics = payload.outboxTopics ?? [];
    return createHash("sha256")
      .update(
        canonicalJsonStringify({
          events,
          outboxTopics,
        }),
      )
      .digest("hex");
  }
  return createHash("sha256")
    .update(
      canonicalJsonStringify({
        events: payload,
        outboxTopics: [],
      }),
    )
    .digest("hex");
}

export async function checkIdempotencyKey(options: {
  client: PoolClient;
  schema: string;
  idempotencyKey: string;
  streamId: string;
  requestHash: string;
}): Promise<AppendResult | null> {
  const { client, schema, idempotencyKey, streamId, requestHash } = options;
  assertValidSchemaName(schema);
  const result = await client.query<IdempotencyKeyRow>(
    `SELECT stream_id, request_hash, from_version, to_version, global_positions
     FROM ${schema}.idempotency_keys
     WHERE key = $1`,
    [idempotencyKey],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
  if (row.stream_id !== streamId) {
    throw new IdempotencyConflictError(
      idempotencyKey,
      `Key was already used for stream "${row.stream_id}"`,
    );
  }
  if (row.request_hash !== requestHash) {
    throw new IdempotencyConflictError(
      idempotencyKey,
      "Idempotency key was already used with a different event payload",
    );
  }
  return {
    streamId: row.stream_id,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    globalPositions: row.global_positions.map((pos) => BigInt(pos)),
    isDuplicate: true,
  };
}

export async function recordIdempotencyKey(options: {
  client: PoolClient;
  schema: string;
  idempotencyKey: string;
  streamId: string;
  requestHash: string;
  fromVersion: number;
  toVersion: number;
  globalPositions: bigint[];
}): Promise<void> {
  const {
    client,
    schema,
    idempotencyKey,
    streamId,
    requestHash,
    fromVersion,
    toVersion,
    globalPositions,
  } = options;
  assertValidSchemaName(schema);
  try {
    await client.query(
      `INSERT INTO ${schema}.idempotency_keys
         (key, stream_id, request_hash, from_version, to_version, global_positions)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        idempotencyKey,
        streamId,
        requestHash,
        fromVersion,
        toVersion,
        globalPositions.map((pos) => pos.toString()),
      ],
    );
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new IdempotencyConflictError(
        idempotencyKey,
        "Key was already used in a concurrent transaction",
      );
    }
    throw error;
  }
}

/**
 * Deletes idempotency key records older than the specified age.
 * Deletes in batches to avoid long lock holds.
 */
export async function cleanupIdempotencyKeys(options: {
  pool: Pool;
  schema: string;
  olderThanMs?: number;
  batchSize?: number;
}): Promise<number> {
  const {
    pool,
    schema,
    olderThanMs = SEVEN_DAYS_MS,
    batchSize = DEFAULT_CLEANUP_BATCH_SIZE,
  } = options;
  assertValidSchemaName(schema);

  let totalDeleted = 0;

  while (true) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM ${schema}.idempotency_keys
         WHERE key IN (
           SELECT key FROM ${schema}.idempotency_keys
           WHERE created_at < now() - make_interval(secs => $1)
           LIMIT $2
         )`,
        [olderThanMs / MS_PER_SECOND, batchSize],
      );

      const deleted = result.rowCount ?? 0;
      totalDeleted += deleted;

      if (deleted < batchSize) {
        break;
      }
    } finally {
      client.release();
    }
  }

  return totalDeleted;
}
