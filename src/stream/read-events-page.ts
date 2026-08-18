import type { PoolClient } from "pg";

import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import { InvalidArgumentError } from "../errors";
import { validateReadEventsPageOptions } from "../input-validation";
import type {
  ReadEventsPage,
  ReadEventsPageOptions,
  ReadEventsPageOrder,
  ReplayedEvent,
} from "../types";
import {
  buildBaseContext,
  processRow,
  type EventRow,
} from "./event-row-processor";
import type { UpcasterRegistry } from "../upcaster/upcaster-registry";

interface ReadEventsCursor {
  version: 1;
  order: ReadEventsPageOrder;
  streamIds: string[];
  watermark: string;
  snapshot: string;
  globalPosition: string;
  streamId: string;
  eventId: string;
}

interface ReadEventsBoundary {
  watermark: bigint;
  snapshot: string;
}

const NO_CURSOR_LIMIT_PARAMETER = "$4";
const CURSOR_LIMIT_PARAMETER = "$7";
const MAX_XID8 = 18_446_744_073_709_551_615n;
const POSTGRES_SNAPSHOT_PART_COUNT = 3;

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function isCursorStreamIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (streamId) => typeof streamId === "string" && streamId.length > 0,
    ) &&
    new Set(value).size === value.length
  );
}

function isSnapshotXid(value: string): boolean {
  if (!isDecimalString(value)) return false;
  return BigInt(value) <= MAX_XID8;
}

function isPostgresSnapshot(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length !== POSTGRES_SNAPSHOT_PART_COUNT) return false;
  const [xmin, xmax, inProgress] = parts;
  if (!xmin || !xmax || !isSnapshotXid(xmin) || !isSnapshotXid(xmax)) {
    return false;
  }
  return (
    inProgress === "" ||
    inProgress.split(",").every((transactionId) => isSnapshotXid(transactionId))
  );
}

function isReadEventsCursor(value: unknown): value is ReadEventsCursor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return [
    candidate.version === 1,
    isCursorStreamIds(candidate.streamIds),
    candidate.order === "asc" || candidate.order === "desc",
    isDecimalString(candidate.watermark),
    isPostgresSnapshot(candidate.snapshot),
    isDecimalString(candidate.globalPosition),
    typeof candidate.streamId === "string" && candidate.streamId.length > 0,
    typeof candidate.eventId === "string" && candidate.eventId.length > 0,
  ].every(Boolean);
}

async function captureReadEventsBoundary(options: {
  client: PoolClient;
  schema: string;
}): Promise<ReadEventsBoundary> {
  const { client, schema } = options;
  const result = await client.query<{
    watermark: string;
    snapshot: string;
  }>(
    `SELECT pg_current_snapshot()::text AS snapshot,
            COALESCE(
              (SELECT global_position
                 FROM ${schema}.events
                ORDER BY global_position DESC
                LIMIT 1),
              0
            )::bigint AS watermark`,
  );
  const boundary = result.rows[0];
  if (!boundary) {
    throw new Error("Failed to capture the event read boundary");
  }
  return {
    watermark: BigInt(boundary.watermark),
    snapshot: boundary.snapshot,
  };
}

function encodeReadEventsCursor(cursor: ReadEventsCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeReadEventsCursor(value: string): ReadEventsCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new InvalidArgumentError("cursor", "must be a valid Alvyn cursor");
  }

  if (!isReadEventsCursor(parsed)) {
    throw new InvalidArgumentError("cursor", "must be a valid Alvyn cursor");
  }
  return parsed;
}

function sameStreamSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return sortedLeft.every((streamId, index) => streamId === sortedRight[index]);
}

function resolvePageCursor(options: {
  pageOptions: ReadEventsPageOptions;
  streamIds: string[];
  order: ReadEventsPageOrder;
}): ReadEventsCursor | null {
  const { pageOptions, streamIds, order } = options;
  if (!pageOptions.cursor) return null;
  const cursor = decodeReadEventsCursor(pageOptions.cursor);
  if (cursor.order !== order || !sameStreamSet(cursor.streamIds, streamIds)) {
    throw new InvalidArgumentError(
      "cursor",
      "does not match streamIds and order from the initial request",
    );
  }
  return cursor;
}

function buildReadEventsPageQueryValues(options: {
  streamIds: string[];
  boundary: ReadEventsBoundary;
  cursor: ReadEventsCursor | null;
  limit: number;
}): (string[] | string | number)[] {
  const { streamIds, boundary, cursor, limit } = options;
  if (!cursor) {
    return [
      streamIds,
      boundary.watermark.toString(),
      boundary.snapshot,
      limit + 1,
    ];
  }
  return [
    streamIds,
    boundary.watermark.toString(),
    boundary.snapshot,
    cursor.globalPosition,
    cursor.streamId,
    cursor.eventId,
    limit + 1,
  ];
}

function buildReadEventsPageQuery(options: {
  schema: string;
  streamIds: string[];
  order: ReadEventsPageOrder;
  boundary: ReadEventsBoundary;
  cursor: ReadEventsCursor | null;
  limit: number;
}): { text: string; values: (string[] | string | number)[] } {
  const { schema, streamIds, order, boundary, cursor, limit } = options;
  const direction = order === "asc" ? "ASC" : "DESC";
  const comparison = order === "asc" ? ">" : "<";
  const cursorClause = cursor
    ? `AND (event.global_position, event.stream_id, event.id) ${comparison}
         ($4::bigint, $5::text, $6::text)`
    : "";
  const limitParameter = cursor
    ? CURSOR_LIMIT_PARAMETER
    : NO_CURSOR_LIMIT_PARAMETER;
  const values = buildReadEventsPageQueryValues({
    streamIds,
    boundary,
    cursor,
    limit,
  });
  return {
    text: `SELECT e.global_position, e.stream_id, e.stream_version, e.id, e.source,
            e.specversion, e.event_type, e.subject, e.time, e.datacontenttype,
            e.data, e.extensions, e.encrypted_data, e.crypto_key_id,
            e.schema_version, e.created_at
       FROM unnest($1::text[]) AS requested_stream(stream_id)
       CROSS JOIN LATERAL (
         SELECT event.*
           FROM ${schema}.events AS event
          WHERE event.stream_id = requested_stream.stream_id
            AND event.global_position <= $2::bigint
            AND pg_visible_in_snapshot(event.txid, $3::pg_snapshot)
            ${cursorClause}
          ORDER BY event.global_position ${direction}, event.id ${direction}
          LIMIT ${limitParameter}
       ) AS e
      ORDER BY e.global_position ${direction}, e.stream_id ${direction}, e.id ${direction}
      LIMIT ${limitParameter}`,
    values,
  };
}

async function processPageRows<T>(options: {
  rows: EventRow[];
  client: PoolClient;
  schema: string;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry | null;
}): Promise<ReplayedEvent<T>[]> {
  const { rows, client, schema, cryptoKeyManager, upcasterRegistry } = options;
  const keyCache = new Map<string, Buffer | null>();
  const events: ReplayedEvent<T>[] = [];
  for (const row of rows) {
    events.push(
      await processRow<T>({
        row,
        ctx: buildBaseContext(row),
        cryptoKeyManager,
        upcasterRegistry,
        keyCache,
        client,
        schema,
      }),
    );
  }
  return events;
}

function buildNextReadEventsCursor(options: {
  hasNextPage: boolean;
  lastRow: EventRow | undefined;
  order: ReadEventsPageOrder;
  streamIds: string[];
  boundary: ReadEventsBoundary;
}): string | null {
  const { hasNextPage, lastRow, order, streamIds, boundary } = options;
  if (!hasNextPage || !lastRow) return null;
  return encodeReadEventsCursor({
    version: 1,
    order,
    streamIds: [...streamIds].sort((a, b) => a.localeCompare(b)),
    watermark: boundary.watermark.toString(),
    snapshot: boundary.snapshot,
    globalPosition: lastRow.global_position,
    streamId: lastRow.stream_id,
    eventId: lastRow.id,
  });
}

function splitReadEventsPageRows(
  rows: EventRow[],
  limit: number,
): { pageRows: EventRow[]; hasNextPage: boolean } {
  return {
    pageRows: rows.slice(0, limit),
    hasNextPage: rows.length > limit,
  };
}

async function fetchReadEventsPageRows(options: {
  client: PoolClient;
  schema: string;
  pageOptions: ReadEventsPageOptions;
  streamIds: string[];
  order: ReadEventsPageOrder;
  cursor: ReadEventsCursor | null;
}): Promise<{
  boundary: ReadEventsBoundary;
  pageRows: EventRow[];
  hasNextPage: boolean;
}> {
  const { client, schema, pageOptions, streamIds, order, cursor } = options;
  const boundary = cursor
    ? { watermark: BigInt(cursor.watermark), snapshot: cursor.snapshot }
    : await captureReadEventsBoundary({ client, schema });
  const query = buildReadEventsPageQuery({
    schema,
    streamIds,
    order,
    boundary,
    cursor,
    limit: pageOptions.limit,
  });
  const result = await client.query<EventRow>(query.text, query.values);
  const { pageRows, hasNextPage } = splitReadEventsPageRows(
    result.rows,
    pageOptions.limit,
  );
  return { boundary, pageRows, hasNextPage };
}

export async function readEventsPage<T = unknown>(options: {
  client: PoolClient;
  schema: string;
  options: ReadEventsPageOptions;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry | null;
}): Promise<ReadEventsPage<T>> {
  const {
    client,
    schema,
    options: pageOptions,
    cryptoKeyManager,
    upcasterRegistry,
  } = options;
  validateReadEventsPageOptions(pageOptions);

  const order = pageOptions.order ?? "asc";
  const streamIds = [...pageOptions.streamIds];
  const cursor = resolvePageCursor({ pageOptions, streamIds, order });
  if (streamIds.length === 0) {
    return { events: [], hasNextPage: false, nextCursor: null };
  }

  const { boundary, pageRows, hasNextPage } = await fetchReadEventsPageRows({
    client,
    schema,
    pageOptions,
    streamIds,
    order,
    cursor,
  });
  const events = await processPageRows<T>({
    rows: pageRows,
    client,
    schema,
    cryptoKeyManager,
    upcasterRegistry,
  });
  const nextCursor = buildNextReadEventsCursor({
    hasNextPage,
    lastRow: pageRows[pageRows.length - 1],
    order,
    streamIds,
    boundary,
  });
  return { events, hasNextPage, nextCursor };
}
