import type { PoolClient } from "pg";

import type { Projection } from "../types";
import {
  EVENT_ROW_COLUMNS,
  mapRowToEvent,
  type EventRow,
} from "../stream/map-row-to-event";
import { computeSafeWatermark } from "../stream/compute-safe-watermark";

async function ensureCheckpoint(options: {
  client: PoolClient;
  schema: string;
  projectionName: string;
}): Promise<bigint> {
  const { client, schema, projectionName } = options;
  await client.query(
    `INSERT INTO ${schema}.projections (projection_name, last_position) VALUES ($1, 0) ON CONFLICT (projection_name) DO NOTHING`,
    [projectionName],
  );
  const result = await client.query<{ last_position: string }>(
    `SELECT last_position FROM ${schema}.projections WHERE projection_name = $1 FOR UPDATE`,
    [projectionName],
  );
  return BigInt(result.rows[0].last_position);
}

async function updateCheckpoint(options: {
  client: PoolClient;
  schema: string;
  projectionName: string;
  position: bigint;
}): Promise<void> {
  const { client, schema, projectionName, position } = options;
  await client.query(
    `UPDATE ${schema}.projections SET last_position = $1, updated_at = now() WHERE projection_name = $2`,
    [position.toString(), projectionName],
  );
}

/** Runs a projection by processing events from its last checkpoint. */
export async function runProjection(options: {
  client: PoolClient;
  schema: string;
  projection: Projection;
  batchSize: number;
}): Promise<number> {
  const { client, schema, projection, batchSize } = options;

  const lastPosition = await ensureCheckpoint({
    client,
    schema,
    projectionName: projection.projectionName,
  });

  // Bound the read by the commit-safe watermark so a transaction holding a
  // lower global_position that commits *after* a higher one is never skipped
  // (see src/stream/compute-safe-watermark.ts).
  const safeWatermark = await computeSafeWatermark({ client, schema });
  if (safeWatermark <= lastPosition) return 0;

  const eventsResult = await client.query<EventRow>(
    `SELECT ${EVENT_ROW_COLUMNS}
     FROM ${schema}.events
     WHERE global_position > $1 AND global_position <= $2
     ORDER BY global_position ASC LIMIT $3`,
    [lastPosition.toString(), safeWatermark.toString(), batchSize],
  );

  if (eventsResult.rows.length === 0) return 0;

  let newLastPosition = lastPosition;
  for (const row of eventsResult.rows) {
    const event = mapRowToEvent(row);
    await projection.handle(event, client);
    newLastPosition = event.globalPosition;
  }

  await updateCheckpoint({
    client,
    schema,
    projectionName: projection.projectionName,
    position: newLastPosition,
  });

  return eventsResult.rows.length;
}
