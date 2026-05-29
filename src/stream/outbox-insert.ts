import type { PoolClient } from "pg";

import type { CloudEventExtensions } from "../types";

const PARAMS_PER_OUTBOX = 3;
const PG_MAX_PARAMS = 65535;
const MAX_OUTBOX_ROWS_PER_CHUNK = Math.floor(PG_MAX_PARAMS / PARAMS_PER_OUTBOX);

const RESERVED_CE_KEYS = new Set([
  "specversion",
  "id",
  "source",
  "type",
  "subject",
  "time",
  "datacontenttype",
  "dataschema",
  "data",
]);

export interface PreparedRowForOutbox {
  specversion: string;
  id: string;
  source: string;
  eventType: string;
  subject: string;
  time: string;
  datacontenttype: string;
  dataToStore: unknown;
  extensions: CloudEventExtensions;
}

export interface OutboxRow {
  globalPosition: string;
  topic: string;
  payloadJson: string;
}

function buildCloudEventsPayload(
  row: PreparedRowForOutbox,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    specversion: row.specversion,
    id: row.id,
    source: row.source,
    type: row.eventType,
    subject: row.subject,
    time: row.time,
    datacontenttype: row.datacontenttype,
    data: row.dataToStore,
  };
  for (const [key, value] of Object.entries(row.extensions)) {
    if (value !== undefined && !RESERVED_CE_KEYS.has(key)) {
      payload[key] = value;
    }
  }
  return payload;
}

export function buildOutboxRows(options: {
  preparedRows: PreparedRowForOutbox[];
  globalPositions: bigint[];
  outboxTopics: string[];
}): OutboxRow[] {
  const { preparedRows, globalPositions, outboxTopics } = options;
  const allOutboxRows: OutboxRow[] = [];
  for (let i = 0; i < preparedRows.length; i++) {
    const payload = buildCloudEventsPayload(preparedRows[i]);
    const payloadJson = JSON.stringify(payload);
    for (const topic of outboxTopics) {
      allOutboxRows.push({
        globalPosition: globalPositions[i].toString(),
        topic,
        payloadJson,
      });
    }
  }
  return allOutboxRows;
}

export async function insertOutboxChunks(options: {
  client: PoolClient;
  schema: string;
  rows: OutboxRow[];
}): Promise<void> {
  const { client, schema, rows } = options;
  for (
    let chunkStart = 0;
    chunkStart < rows.length;
    chunkStart += MAX_OUTBOX_ROWS_PER_CHUNK
  ) {
    const chunk = rows.slice(
      chunkStart,
      chunkStart + MAX_OUTBOX_ROWS_PER_CHUNK,
    );
    const outboxValues: string[] = [];
    const outboxParams: (string | null)[] = [];
    let idx = 1;
    for (const row of chunk) {
      outboxValues.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
      outboxParams.push(row.globalPosition, row.topic, row.payloadJson);
      idx += PARAMS_PER_OUTBOX;
    }
    await client.query(
      `INSERT INTO ${schema}.outbox (event_global_pos, topic, payload) VALUES ${outboxValues.join(", ")}`,
      outboxParams,
    );
  }
}
