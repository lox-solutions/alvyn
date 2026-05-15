import type { PoolClient } from "pg";

import type { CloudEventExtensions, Projection, StoredEvent } from "../types";

interface EventRow {
  global_position: string;
  stream_id: string;
  stream_version: number;
  id: string;
  source: string;
  specversion: string;
  event_type: string;
  subject: string;
  time: Date;
  datacontenttype: string;
  data: unknown;
  extensions: unknown;
  created_at: Date;
}

function mapRowToEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    source: row.source,
    specversion: row.specversion,
    type: row.event_type,
    subject: row.subject,
    time: row.time.toISOString(),
    datacontenttype: row.datacontenttype,
    data: row.data,
    extensions: (row.extensions ?? {}) as CloudEventExtensions,
    globalPosition: BigInt(row.global_position),
    streamId: row.stream_id,
    streamVersion: row.stream_version,
    createdAt: row.created_at,
  };
}

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

  const eventsResult = await client.query<EventRow>(
    `SELECT global_position, stream_id, stream_version,
            id, source, specversion, event_type,
            subject, time, datacontenttype,
            data, extensions, created_at
     FROM ${schema}.events
     WHERE global_position > $1
     ORDER BY global_position ASC LIMIT $2`,
    [lastPosition.toString(), batchSize],
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
