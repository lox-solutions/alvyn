/*
 * Standalone, disposable PostgreSQL projection benchmark (not a correctness test).
 * Run: pnpm exec tsx load-tests/projection-scenarios.ts
 * Override scale: PROJECTION_HISTORY=10000 PROJECTION_REQUESTS=100 ...
 * Only test/benchmark code; it calls the public EventStore API unchanged.
 */
import { performance } from "node:perf_hooks";
import type pg from "pg";
import { EventStore } from "../src/event-store";
import { defineProjection } from "../src/projection/define-projection";
import {
  createTestPool,
  startPostgres,
  stopPostgres,
  uniqueSchema,
} from "../src/__tests__/setup";

interface Scenario {
  name: string;
  history: number;
  projections: number;
  sqlIndex: boolean;
  concurrency: number;
  requests: number;
  backlog: number;
  backlogAtBurst?: boolean;
  handlerDelayMs?: number;
}

function envInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

const DEFAULT_HISTORY = 2_000;
const DEFAULT_REQUESTS = 40;
const DEFAULT_BACKLOG = 200;
const SHORT_HISTORY = 200;
const MEDIUM_PROJECTION_COUNT = 10;
const LARGE_PROJECTION_COUNT = 50;
const PEAK_CONCURRENCY = 8;
const SEED_BATCH_SIZE = 50;
const PROJECTION_BATCH_SIZE = 500;
const DESCRIPTION_REPEATS = 24;
const MILLISECONDS_PER_SECOND = 1_000;
const PERCENT_SCALE = 100;
const P50 = 0.5;
const P95 = 0.95;
const P99 = 0.99;

const history = envInteger("PROJECTION_HISTORY", DEFAULT_HISTORY);
const requests = envInteger("PROJECTION_REQUESTS", DEFAULT_REQUESTS);
const backlog = envInteger("PROJECTION_BACKLOG", DEFAULT_BACKLOG);
const scenarios: Scenario[] = [
  {
    name: "short-1-noop",
    history: SHORT_HISTORY,
    projections: 1,
    sqlIndex: false,
    concurrency: 1,
    requests,
    backlog,
  },
  {
    name: "history-1-noop",
    history,
    projections: 1,
    sqlIndex: false,
    concurrency: 1,
    requests,
    backlog,
  },
  {
    name: "history-10-noop",
    history,
    projections: MEDIUM_PROJECTION_COUNT,
    sqlIndex: false,
    concurrency: 1,
    requests,
    backlog,
  },
  {
    name: "history-50-noop",
    history,
    projections: LARGE_PROJECTION_COUNT,
    sqlIndex: false,
    concurrency: 1,
    requests,
    backlog,
  },
  {
    name: "history-10-gin-peak",
    history,
    projections: MEDIUM_PROJECTION_COUNT,
    sqlIndex: true,
    concurrency: PEAK_CONCURRENCY,
    requests,
    backlog,
  },
  {
    name: "history-50-gin-peak",
    history,
    projections: LARGE_PROJECTION_COUNT,
    sqlIndex: true,
    concurrency: PEAK_CONCURRENCY,
    requests,
    backlog,
  },
  {
    name: "history-50-gin-peak-with-backlog",
    history,
    projections: LARGE_PROJECTION_COUNT,
    sqlIndex: true,
    concurrency: PEAK_CONCURRENCY,
    requests,
    backlog,
    backlogAtBurst: true,
  },
  {
    name: "history-10-slow-sql-peak",
    history,
    projections: MEDIUM_PROJECTION_COUNT,
    sqlIndex: true,
    concurrency: PEAK_CONCURRENCY,
    requests,
    backlog,
    handlerDelayMs: 2,
  },
];

type BenchProjection = ReturnType<
  ReturnType<typeof defineProjection<{ Changed: { body: string } }>>
>;

function percentiles(samples: number[]): {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
} {
  if (!samples.length) return { p50: null, p95: null, p99: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const get = (p: number) =>
    Math.round(sorted[Math.ceil(p * sorted.length) - 1] * PERCENT_SCALE) /
    PERCENT_SCALE;
  return { p50: get(P50), p95: get(P95), p99: get(P99), max: get(1) };
}

async function appendEvents(options: {
  store: EventStore;
  prefix: string;
  id: string;
  count: number;
}): Promise<bigint> {
  const { store, prefix, id, count } = options;
  const result = await store.append({
    streamId: `${prefix}-${id}`,
    expectedVersion: -1,
    events: Array.from({ length: count }, (_, i) => ({
      type: "Changed",
      data: {
        body: `${prefix} ${id} ${i} ${"searchable description issue customer order ".repeat(DESCRIPTION_REPEATS)}`,
      },
    })),
  });
  return result.globalPositions.at(-1)!;
}

async function seed(options: {
  store: EventStore;
  count: number;
  projections: number;
  offset: number;
}): Promise<void> {
  const { store, count, projections, offset } = options;
  for (let i = 0; i < count; i += SEED_BATCH_SIZE) {
    await appendEvents({
      store,
      prefix: `Entity${(Math.floor(i / SEED_BATCH_SIZE) + offset) % projections}`,
      id: `seed-${offset + i}`,
      count: Math.min(SEED_BATCH_SIZE, count - i),
    });
  }
}

async function setupIndex(pool: pg.Pool, schema: string): Promise<void> {
  await pool.query(`CREATE TABLE ${schema}.search_docs (
    id text PRIMARY KEY, body text NOT NULL,
    vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
  )`);
  await pool.query(
    `CREATE INDEX projection_bench_gin ON ${schema}.search_docs USING gin(vector)`,
  );
}

async function runScenario(
  pool: pg.Pool,
  scenario: Scenario,
): Promise<Record<string, unknown>> {
  const schema = uniqueSchema();
  const store = new EventStore({ pool, schema });
  await store.setup();
  if (scenario.sqlIndex) await setupIndex(pool, schema);
  const handlerMs: number[] = [];
  const projections: BenchProjection[] = Array.from(
    { length: scenario.projections },
    (_, i) =>
      defineProjection<{ Changed: { body: string } }>()({
        projectionName: `search-${i}`,
        streamPrefix: `Entity${i}`,
        handlers: {
          Changed: async (data, ctx) => {
            const started = performance.now();
            if (scenario.sqlIndex) {
              await ctx.client.query(
                `INSERT INTO ${schema}.search_docs(id, body) VALUES ($1, $2)
               ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
                [`${ctx.streamId}:${ctx.streamVersion}`, data.body],
              );
            }
            if (scenario.handlerDelayMs) {
              await ctx.client.query("SELECT pg_sleep($1)", [
                scenario.handlerDelayMs / MILLISECONDS_PER_SECOND,
              ]);
            }
            handlerMs.push(performance.now() - started);
          },
        },
      }),
  );
  async function drain(): Promise<number> {
    let total = 0;
    for (const projection of projections) {
      let count: number;
      do {
        count = await store.runProjection(projection, PROJECTION_BATCH_SIZE);
        total += count;
      } while (count === PROJECTION_BATCH_SIZE);
    }
    return total;
  }

  await seed({
    store,
    count: scenario.history,
    projections: scenario.projections,
    offset: 0,
  });
  const firstStarted = performance.now();
  const historyRowsRead = await drain();
  const initialCatchupMs = performance.now() - firstStarted;

  await seed({
    store,
    count: scenario.backlog,
    projections: scenario.projections,
    offset: scenario.history,
  });
  const backlogStarted = performance.now();
  const backlogRowsRead = scenario.backlogAtBurst ? null : await drain();
  const backlogCatchupMs = scenario.backlogAtBurst
    ? null
    : performance.now() - backlogStarted;

  const appendMs: number[] = [];
  const requestMs: number[] = [];
  const postAppendMs: number[] = [];
  const indexedByReturn: boolean[] = [];
  let next = 0;
  const burstStarted = performance.now();
  await Promise.all(
    Array.from({ length: scenario.concurrency }, async () => {
      while (next < scenario.requests) {
        const n = next++;
        const prefix = `Entity${n % scenario.projections}`;
        const started = performance.now();
        const position = await appendEvents({
          store,
          prefix,
          id: `burst-${n}`,
          count: 1,
        });
        const appendedAt = performance.now();
        appendMs.push(appendedAt - started);
        await drain();
        const finishedAt = performance.now();
        requestMs.push(finishedAt - started);
        postAppendMs.push(finishedAt - appendedAt);
        // A request may have been overtaken by another worker; check the durable
        // cursor rather than assuming its own drain() handled its event.
        const checkpoint = await pool.query<{ last_position: string }>(
          `SELECT last_position::text FROM ${schema}.projections WHERE projection_name = $1`,
          [`search-${n % scenario.projections}`],
        );
        indexedByReturn.push(
          BigInt(checkpoint.rows[0].last_position) >= position,
        );
      }
    }),
  );
  const burstMs = performance.now() - burstStarted;
  const finalRowsRead = await drain();
  const queryPlan = await pool.query<{ "QUERY PLAN": string }>(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT COALESCE(
      (SELECT MIN(global_position) - 1 FROM ${schema}.events
       WHERE txid >= pg_snapshot_xmin(pg_current_snapshot())),
      (SELECT MAX(global_position) FROM ${schema}.events), 0)::bigint`,
  );
  const report = {
    scenario,
    historyRowsRead,
    initialCatchupMs: Math.round(initialCatchupMs),
    backlogRowsRead,
    backlogCatchupMs:
      backlogCatchupMs === null ? null : Math.round(backlogCatchupMs),
    burstMs: Math.round(burstMs),
    burstRequestsPerSecond:
      Math.round(
        ((MILLISECONDS_PER_SECOND * scenario.requests) / burstMs) *
          PERCENT_SCALE,
      ) / PERCENT_SCALE,
    appendMs: percentiles(appendMs),
    requestMs: percentiles(requestMs),
    postAppendMs: percentiles(postAppendMs),
    handlerMs: percentiles(handlerMs),
    indexedByReturn: `${indexedByReturn.filter(Boolean).length}/${scenario.requests}`,
    finalRowsRead,
    watermarkExplain: queryPlan.rows.map((row) => row["QUERY PLAN"]),
  };
  return report;
}

await startPostgres();
const pool = createTestPool();
try {
  for (const scenario of scenarios) {
    const result = await runScenario(pool, scenario);
    console.log(JSON.stringify(result));
  }
} finally {
  await pool.end();
  await stopPostgres();
}
