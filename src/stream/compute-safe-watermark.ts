import type { PoolClient } from "pg";

import {
  WATERMARK_LOCK_KEY,
  WATERMARK_READER_LOCK_KEY,
} from "../event-store-constants";

/**
 * Returns a commit-safe position for cursor-based consumers.
 *
 * Transaction IDs cannot establish position order: an older transaction can
 * append both before AND after a younger in-flight transaction. The events
 * table cannot reveal the younger transaction's uncommitted middle row.
 *
 * A BEFORE INSERT statement trigger on the events table takes a shared,
 * transaction-scoped, per-schema advisory lock BEFORE reserving a position.
 * If we can take its exclusive counterpart, all transactions that may have
 * reserved positions are finished. The highest then-visible position
 * (including permanent sequence gaps) is safe forever. We cache that
 * certified position in a PostgreSQL sequence: setval is non-transactional,
 * so the certificate survives a later projection handler rollback.
 *
 * With a writer in flight, return the last certified value immediately rather
 * than waiting or guessing from visible transaction IDs. A separate, short
 * reader-only lock serializes certification attempts, so competing consumers
 * cannot mistake another consumer for a writer and return a stale value.
 *
 * Call with a client OUTSIDE an explicit transaction. The fence uses its own
 * short transaction and releases both locks on COMMIT/ROLLBACK. In particular,
 * it never holds a writer lock while running user projection handlers. Using
 * transaction-scoped rather than session locks also supports connection pools
 * that multiplex sessions between transactions.
 */
export async function computeSafeWatermark(options: {
  client: PoolClient;
  schema: string;
}): Promise<bigint> {
  const { client, schema } = options;
  const sequence = `${schema}.projection_safe_watermark`;

  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), $2)`, [
      schema,
      WATERMARK_READER_LOCK_KEY,
    ]);
    const lock = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext($1), $2) AS acquired`,
      [schema, WATERMARK_LOCK_KEY],
    );
    const cached = await client.query<{ last_value: string }>(
      `SELECT last_value::text FROM ${sequence}`,
    );
    const lastCertified = BigInt(cached.rows[0].last_value);
    let safePosition = lastCertified;

    if (lock.rows[0]?.acquired) {
      const result = await client.query<{ last_position: string }>(
        `SELECT COALESCE(MAX(global_position), 0)::text AS last_position FROM ${schema}.events`,
      );
      const position = BigInt(result.rows[0].last_position);
      if (position > lastCertified) {
        await client.query(`SELECT setval($1::regclass, $2::bigint, true)`, [
          sequence,
          position.toString(),
        ]);
        safePosition = position;
      }
    }
    await client.query("COMMIT");
    return safePosition;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
