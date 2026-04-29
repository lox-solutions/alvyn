import type { PoolClient } from "pg";

import type { CloudEventExtensions, Projection, StoredEvent } from "../types";

interface EventRow {
  global_position: string;
  stream_id: string;
  stream_version: number;
  // CloudEvents REQUIRED
  id: string;
  source: string;
  specversion: string;
  event_type: string;
  // CloudEvents OPTIONAL
  subject: string;
  time: Date;
  datacontenttype: string;
  // Data & extensions
  data: unknown;
  extensions: unknown;
  created_at: Date;
}

/**
 * Runs a projection by processing events sequentially from its last checkpoint.
 *
 * Events are returned as CloudEvents v1.0.2 compliant StoredEvent objects.
 *
 * The projection tracks its progress via the `projections` table
 * (global_position-based checkpoint). This allows:
 * - Multiple independent projections to run at their own pace
 * - Crash recovery — just restart from the last checkpoint
 * - Horizontal scaling — each projection name is unique, so multiple
 *   instances of the same projection will NOT conflict (use separate names
 *   if you need parallel projection workers)
 *
 * Returns the number of events processed in this batch.
 */
export async function runProjection(
  client: PoolClient,
  schema: string,
  projection: Projection,
  batchSize: number,
): Promise<number> {
  // Get or create the projection checkpoint
  await client.query(
    `INSERT INTO ${schema}.projections (projection_name, last_position)
     VALUES ($1, 0)
     ON CONFLICT (projection_name) DO NOTHING`,
    [projection.projectionName],
  );

  const checkpointResult = await client.query<{ last_position: string }>(
    `SELECT last_position FROM ${schema}.projections WHERE projection_name = $1 FOR UPDATE`,
    [projection.projectionName],
  );

  const lastPosition = BigInt(checkpointResult.rows[0]!.last_position);

  // Fetch next batch of events (plain events only — projections
  // typically do NOT need encrypted data since they build read models)
  const eventsResult = await client.query<EventRow>(
    `SELECT global_position, stream_id, stream_version,
            id, source, specversion, event_type,
            subject, time, datacontenttype,
            data, extensions, created_at
     FROM ${schema}.events
     WHERE global_position > $1
     ORDER BY global_position ASC
     LIMIT $2`,
    [lastPosition.toString(), batchSize],
  );

  if (eventsResult.rows.length === 0) {
    return 0;
  }

  let newLastPosition = lastPosition;

  for (const row of eventsResult.rows) {
    const event: StoredEvent = {
      // CloudEvents REQUIRED
      id: row.id,
      source: row.source,
      specversion: row.specversion,
      type: row.event_type,
      // CloudEvents OPTIONAL
      subject: row.subject,
      time: row.time.toISOString(),
      datacontenttype: row.datacontenttype,
      // Data & extensions
      data: row.data,
      extensions: (row.extensions ?? {}) as CloudEventExtensions,
      // Internal
      globalPosition: BigInt(row.global_position),
      streamId: row.stream_id,
      streamVersion: row.stream_version,
      createdAt: row.created_at,
    };

    await projection.handle(event, client);
    newLastPosition = event.globalPosition;
  }

  // Update checkpoint
  await client.query(
    `UPDATE ${schema}.projections
     SET last_position = $1, updated_at = now()
     WHERE projection_name = $2`,
    [newLastPosition.toString(), projection.projectionName],
  );

  return eventsResult.rows.length;
}
