import type { PoolClient } from "pg";

import type {
  Projection,
  RedactedProjectionEvent,
  TombstonedEvent,
} from "../types";
import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import type { UpcasterRegistry } from "../upcaster/upcaster-registry";
import {
  buildBaseContext,
  processRow,
  type EventRow,
} from "../stream/event-row-processor";

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

function ignoresStream(projection: Projection, streamId: string): boolean {
  return (
    "streamPrefix" in projection &&
    typeof projection.streamPrefix === "string" &&
    !streamId.startsWith(`${projection.streamPrefix}-`)
  );
}

async function handleRedactedEvent(options: {
  event: TombstonedEvent;
  client: PoolClient;
  projection: Projection;
}): Promise<void> {
  const { event, client, projection } = options;
  if (projection.onRedacted === "skip") return;
  if (!projection.onRedacted) {
    throw new Error(
      `Redacted event ${event.id} at position ${event.globalPosition} requires an onRedacted policy`,
    );
  }
  const redacted: RedactedProjectionEvent = { ...event, redacted: true };
  await projection.onRedacted(redacted, client);
}

async function processProjectionRow(options: {
  row: EventRow;
  client: PoolClient;
  schema: string;
  projection: Projection;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry;
  keyCache: Map<string, Buffer | null>;
}): Promise<void> {
  const {
    row,
    client,
    schema,
    projection,
    cryptoKeyManager,
    upcasterRegistry,
    keyCache,
  } = options;
  const event = await processRow({
    row,
    ctx: buildBaseContext(row),
    cryptoKeyManager,
    upcasterRegistry,
    keyCache,
    client,
    schema,
  });
  if ("tombstoned" in event) {
    await handleRedactedEvent({ event, client, projection });
    return;
  }
  await projection.handle(event, client);
}

/** Runs a projection by processing events from its last checkpoint. */
export async function runProjection(options: {
  client: PoolClient;
  schema: string;
  projection: Projection;
  batchSize: number;
  safeWatermark: bigint;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry;
}): Promise<number> {
  const {
    client,
    schema,
    projection,
    batchSize,
    safeWatermark,
    cryptoKeyManager,
    upcasterRegistry,
  } = options;

  const lastPosition = await ensureCheckpoint({
    client,
    schema,
    projectionName: projection.projectionName,
  });

  // The bound was certified before this transaction began. It stays safe even
  // if new writers start while the projection processes this batch.
  if (safeWatermark <= lastPosition) return 0;

  const eventsResult = await client.query<EventRow>(
    `SELECT global_position, stream_id, stream_version, id, source, specversion, event_type,
            subject, time, datacontenttype, data, extensions, encrypted_data, crypto_key_id, schema_version, created_at
     FROM ${schema}.events
     WHERE global_position > $1 AND global_position <= $2
     ORDER BY global_position ASC LIMIT $3`,
    [lastPosition.toString(), safeWatermark.toString(), batchSize],
  );

  if (eventsResult.rows.length === 0) return 0;

  let newLastPosition = lastPosition;
  const keyCache = new Map<string, Buffer | null>();
  for (const row of eventsResult.rows) {
    // Typed projections already filter by prefix in handle(); avoid decrypting
    // unrelated events (including shredded events) before that filter runs.
    if (!ignoresStream(projection, row.stream_id)) {
      await processProjectionRow({
        row,
        client,
        schema,
        projection,
        cryptoKeyManager,
        upcasterRegistry,
        keyCache,
      });
    }
    newLastPosition = BigInt(row.global_position);
  }

  await updateCheckpoint({
    client,
    schema,
    projectionName: projection.projectionName,
    position: newLastPosition,
  });

  return eventsResult.rows.length;
}
