import type { Pool } from "pg";

import { markOutboxProcessed, pollOutbox } from "./outbox-relay";
import type { OutboxHandler } from "../types";

const DEFAULT_OUTBOX_BATCH_SIZE = 100;
const DEFAULT_CLEANUP_BATCH_SIZE = 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MS_PER_SECOND = 1000;

/**
 * Processes pending outbox entries atomically.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing.
 */
export async function processOutbox(options: {
  pool: Pool;
  schema: string;
  handler: OutboxHandler;
  limit?: number;
}): Promise<number> {
  const { pool, schema, handler, limit } = options;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const entries = await pollOutbox({
      client,
      schema,
      limit: limit ?? DEFAULT_OUTBOX_BATCH_SIZE,
    });

    if (entries.length === 0) {
      await client.query("COMMIT");
      return 0;
    }

    await handler(entries, client);

    const ids = entries.map((e) => e.id);
    await markOutboxProcessed({ client, schema, ids });

    await client.query("COMMIT");
    return entries.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes processed outbox entries older than the specified age.
 * Deletes in batches to avoid long lock holds.
 */
export async function cleanupOutbox(options: {
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

  let totalDeleted = 0;

  while (true) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM ${schema}.outbox
         WHERE id IN (
           SELECT id FROM ${schema}.outbox
           WHERE processed_at IS NOT NULL
             AND processed_at < now() - make_interval(secs => $1)
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
