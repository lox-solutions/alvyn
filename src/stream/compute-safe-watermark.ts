import type { PoolClient } from "pg";

/**
 * Computes the commit-safe high-water `global_position` for cursor-based
 * consumers.
 *
 * `global_position` is a `BIGSERIAL`: its value is reserved at INSERT time but
 * only becomes visible at COMMIT time. With concurrent writers (e.g. multiple
 * replicas), a transaction holding position 5 can commit *after* a transaction
 * holding position 6. A naive consumer that advances a cursor with
 * `WHERE global_position > cursor ORDER BY global_position` would move past 6
 * and **permanently skip 5**.
 *
 * To avoid this, every event records the appending transaction id in the
 * `txid` column (`pg_current_xact_id()`). A position is *safe* to emit only
 * once its owning transaction is no longer in-flight, and no still-running
 * transaction could later reveal a lower position.
 *
 * We use the current snapshot's `xmin` (`pg_snapshot_xmin(pg_current_snapshot())`),
 * which is the oldest transaction id still considered in-progress. Any event
 * whose `txid` is `>= xmin` might still be in-flight (or have committed after a
 * still-running transaction started), so it is treated conservatively as
 * unsafe. The safe watermark is therefore one less than the smallest
 * `global_position` of any such potentially-in-flight event.
 *
 * Gaps left behind by committed/aborted transactions whose `txid < xmin` are
 * permanent and skippable, so they never stall the watermark.
 *
 * @returns the largest `global_position` such that every position at or below
 *   it belongs to a transaction that is no longer in-flight; `0n` when no
 *   position is yet safe (or the table is empty).
 */
export async function computeSafeWatermark(options: {
  client: PoolClient;
  schema: string;
}): Promise<bigint> {
  const { client, schema } = options;
  const result = await client.query<{ safe_position: string | null }>(
    `SELECT COALESCE(
       (SELECT MIN(global_position) - 1
          FROM ${schema}.events
         WHERE txid >= pg_snapshot_xmin(pg_current_snapshot())),
       (SELECT MAX(global_position) FROM ${schema}.events),
       0
     )::bigint AS safe_position`,
  );
  const value = result.rows[0]?.safe_position;
  return value === null || value === undefined ? 0n : BigInt(value);
}
