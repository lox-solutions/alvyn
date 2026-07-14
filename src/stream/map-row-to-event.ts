import type { CloudEventExtensions, StoredEvent } from "../types";

/** Raw row shape selected from the `events` table for full-event reads. */
export interface EventRow {
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

/** The column list (in order) that produces an {@link EventRow}. */
export const EVENT_ROW_COLUMNS = `global_position, stream_id, stream_version,
            id, source, specversion, event_type,
            subject, time, datacontenttype,
            data, extensions, created_at`;

/** Maps a raw `events` table row into a {@link StoredEvent}. */
export function mapRowToEvent(row: EventRow): StoredEvent {
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
