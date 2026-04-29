import type { PoolClient } from "pg";

import type { OutboxEntry } from "../types";

interface OutboxRow {
  id: string;
  event_global_pos: string;
  topic: string;
  payload: unknown;
  created_at: Date;
}

/**
 * Polls pending outbox entries for processing.
 *
 * Uses SELECT ... FOR UPDATE SKIP LOCKED to safely support multiple
 * concurrent relay workers (across replicas). Each worker gets a
 * disjoint set of entries — no double-processing.
 */
export async function pollOutbox(
  client: PoolClient,
  schema: string,
  limit: number,
): Promise<OutboxEntry[]> {
  const result = await client.query<OutboxRow>(
    `SELECT id, event_global_pos, topic, payload, created_at
     FROM ${schema}.outbox
     WHERE processed_at IS NULL
     ORDER BY id ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  return result.rows.map((row) => ({
    id: BigInt(row.id),
    eventGlobalPosition: BigInt(row.event_global_pos),
    topic: row.topic,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

/**
 * Marks outbox entries as processed by setting processed_at.
 * Call this after successfully dispatching the messages.
 */
export async function markOutboxProcessed(
  client: PoolClient,
  schema: string,
  ids: bigint[],
): Promise<void> {
  if (ids.length === 0) return;

  // Convert bigints to strings for the query parameter
  const idStrings = ids.map((id) => id.toString());

  await client.query(
    `UPDATE ${schema}.outbox
     SET processed_at = now()
     WHERE id = ANY($1::bigint[])`,
    [idStrings],
  );
}
