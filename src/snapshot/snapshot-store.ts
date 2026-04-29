import type { PoolClient } from "pg";

import type { SaveSnapshotInput, Snapshot } from "../types";

interface SnapshotRow {
  stream_id: string;
  stream_version: number;
  snapshot_type: string;
  data: unknown;
  created_at: Date;
}

/**
 * JSON replacer that preserves Map and Set data during serialization.
 *
 * - `Map` → plain object via `Object.fromEntries()`
 * - `Set` → array via spread
 *
 * Without this, `JSON.stringify(new Set([1,2]))` produces `"{}"` — silent data loss.
 */
function snapshotReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

/**
 * Loads the latest snapshot for a stream.
 * Returns null if no snapshot exists.
 */
export async function loadSnapshot<T = unknown>(
  client: PoolClient,
  schema: string,
  streamId: string,
): Promise<Snapshot<T> | null> {
  const result = await client.query<SnapshotRow>(
    `SELECT stream_id, stream_version, snapshot_type, data, created_at
     FROM ${schema}.snapshots
     WHERE stream_id = $1`,
    [streamId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;

  return {
    streamId: row.stream_id,
    streamVersion: row.stream_version,
    snapshotType: row.snapshot_type,
    data: row.data as T,
    createdAt: row.created_at,
  };
}

/**
 * Saves a snapshot for a stream.
 * Uses INSERT ... ON CONFLICT to always keep only the latest snapshot per stream.
 */
export async function saveSnapshot<T = unknown>(
  client: PoolClient,
  schema: string,
  input: SaveSnapshotInput<T>,
): Promise<void> {
  await client.query(
    `INSERT INTO ${schema}.snapshots (stream_id, stream_version, snapshot_type, data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stream_id) DO UPDATE SET
       stream_version = EXCLUDED.stream_version,
       snapshot_type = EXCLUDED.snapshot_type,
       data = EXCLUDED.data,
       created_at = now()`,
    [
      input.streamId,
      input.streamVersion,
      input.snapshotType,
      JSON.stringify(input.data, snapshotReplacer),
    ],
  );
}

/**
 * Deletes the snapshot for a stream.
 * Used when a crypto key is revoked — the snapshot may contain PII
 * and should be invalidated to force a full replay (which will produce tombstones).
 */
export async function deleteSnapshot(
  client: PoolClient,
  schema: string,
  streamId: string,
): Promise<void> {
  await client.query(`DELETE FROM ${schema}.snapshots WHERE stream_id = $1`, [
    streamId,
  ]);
}
