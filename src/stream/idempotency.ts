import type { PoolClient } from "pg";
import { IdempotencyConflictError } from "../errors";
import type { AppendResult } from "../types";

interface IdempotencyKeyRow {
  stream_id: string;
  from_version: number;
  to_version: number;
  global_positions: (string | number | bigint)[];
}

export async function checkIdempotencyKey(options: {
  client: PoolClient;
  schema: string;
  idempotencyKey: string;
  streamId: string;
}): Promise<AppendResult | null> {
  const { client, schema, idempotencyKey, streamId } = options;
  const result = await client.query<IdempotencyKeyRow>(
    `SELECT stream_id, from_version, to_version, global_positions
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
  return {
    streamId: row.stream_id,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    globalPositions: row.global_positions.map((pos) => BigInt(pos)),
  };
}

export async function recordIdempotencyKey(options: {
  client: PoolClient;
  schema: string;
  idempotencyKey: string;
  streamId: string;
  fromVersion: number;
  toVersion: number;
  globalPositions: bigint[];
}): Promise<void> {
  const {
    client,
    schema,
    idempotencyKey,
    streamId,
    fromVersion,
    toVersion,
    globalPositions,
  } = options;
  try {
    await client.query(
      `INSERT INTO ${schema}.idempotency_keys
         (key, stream_id, from_version, to_version, global_positions)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        idempotencyKey,
        streamId,
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
