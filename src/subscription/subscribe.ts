import type { Pool } from "pg";

import type { StoredEvent } from "../types";
import { withClient } from "../pg-helpers";
import {
  EVENT_ROW_COLUMNS,
  mapRowToEvent,
  type EventRow,
} from "../stream/map-row-to-event";
import { computeSafeWatermark } from "../stream/compute-safe-watermark";
import { buildSubjectFilter } from "./subject-filter";
import type { SubscribeOptions } from "./subscribe-options";

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_POLL_INTERVAL_MS = 1000;
/** First positional placeholder available to the subject filter ($1=cursor, $2=watermark). */
const FILTER_PARAM_START = 3;

/**
 * A waker lets the catch-up loop block until either new events may be available
 * (a live notification), a timeout elapses (polling fallback), or the
 * subscription is aborted. The default is polling-only; the event store injects
 * a `LISTEN/NOTIFY`-backed waker.
 */
export interface SubscriptionWaker {
  /** Resolves on a wake-up notification, after `timeoutMs`, or when aborted. */
  wait(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  /** Releases any resources held by the waker. */
  close(): Promise<void> | void;
}

/** Resolves once after `timeoutMs` or when the signal aborts. */
export function sleep(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** A polling-only waker: simply sleeps for the poll interval (abort-aware). */
function createPollingWaker(): SubscriptionWaker {
  return {
    wait: (timeoutMs, signal) => sleep(timeoutMs, signal),
    close: () => undefined,
  };
}

/** Resolves the initial exclusive cursor (a `global_position`) from options. */
function resolveStartCursor(options: SubscribeOptions): bigint {
  const lower = options.lowerBound;
  if (!lower) return 0n;
  const pos = BigInt(lower.id);
  // The catch-up read uses `global_position > cursor` (exclusive), so for an
  // inclusive lower bound we step back one position.
  return lower.type === "inclusive" ? pos - 1n : pos;
}

interface CatchUpQuery {
  sql: string;
  filterParams: (string | string[])[];
}

/** Builds the catch-up SELECT and its (static) filter parameters once. */
function buildCatchUpQuery(
  schema: string,
  options: SubscribeOptions,
): CatchUpQuery {
  const filter = buildSubjectFilter(
    {
      subject: options.subject,
      recursive: options.recursive,
      eventTypes: options.eventTypes,
    },
    FILTER_PARAM_START,
  );
  const filterClause = filter.clause ? ` AND ${filter.clause}` : "";
  const limitIndex = FILTER_PARAM_START + filter.params.length;
  const sql = `SELECT ${EVENT_ROW_COLUMNS}
     FROM ${schema}.events
     WHERE global_position > $1 AND global_position <= $2${filterClause}
     ORDER BY global_position ASC LIMIT $${limitIndex}`;
  return { sql, filterParams: filter.params };
}

export interface SubscribeDeps {
  pool: Pool;
  schema: string;
  options?: SubscribeOptions;
  /** Optional waker factory (the event store injects the NOTIFY-backed waker). */
  createWaker?: () => SubscriptionWaker;
}

interface PumpOptions {
  deps: SubscribeDeps;
  query: CatchUpQuery;
  cursor: bigint;
  batchSize: number;
}

interface PumpResult {
  cursor: bigint;
  caughtUp: boolean;
}

/**
 * Pumps one catch-up batch: yields each matching event above `cursor` up to the
 * commit-safe watermark, then returns the advanced cursor and whether the stream
 * is fully caught up (i.e. the batch was short).
 *
 * Both the watermark query and the event read share a single pool connection to
 * halve connection checkouts per poll tick.
 */
async function* pumpBatch(
  options: PumpOptions,
): AsyncGenerator<StoredEvent, PumpResult, void> {
  const { deps, query, cursor, batchSize } = options;
  const rows = await withClient(deps.pool, async (c) => {
    const watermark = await computeSafeWatermark({
      client: c,
      schema: deps.schema,
    });
    if (watermark <= cursor) return null;
    const result = await c.query<EventRow>(query.sql, [
      cursor.toString(),
      watermark.toString(),
      ...query.filterParams,
      batchSize,
    ]);
    return result.rows;
  });
  if (rows === null) return { cursor, caughtUp: true };

  let next = cursor;
  for (const row of rows) {
    const event = mapRowToEvent(row);
    next = event.globalPosition;
    yield event;
  }
  return { cursor: next, caughtUp: rows.length < batchSize };
}

/**
 * Builds an `AsyncIterable<StoredEvent>` that streams matching historical events
 * in gap-free `global_position` order (catch-up), then transitions seamlessly
 * to live events on the same iterator.
 *
 * Ordering safety: reads are bounded by the commit-safe watermark
 * (see {@link computeSafeWatermark}) so a late-committing lower position is
 * never skipped, even with concurrent writers across replicas.
 */
export async function* subscribe(
  deps: SubscribeDeps,
): AsyncGenerator<StoredEvent, void, void> {
  const options = deps.options ?? {};
  const signal = options.signal;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const query = buildCatchUpQuery(deps.schema, options);

  let cursor = resolveStartCursor(options);
  const waker = (deps.createWaker ?? createPollingWaker)();

  try {
    while (!signal?.aborted) {
      const result = yield* pumpBatch({ deps, query, cursor, batchSize });
      cursor = result.cursor;
      // A short batch means we drained everything available; wait for a wake-up
      // (or the poll interval) before checking again.
      if (result.caughtUp) await waker.wait(pollIntervalMs, signal);
    }
  } finally {
    await waker.close();
  }
}
