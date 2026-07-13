<div align="center">
  <picture>
    <img alt="Alvyn" src="./logo.png" width="315">
  </picture>
</div>

<br>

# Alvyn

> **Beta** — Alvyn is under active development. The API may change before v1.0. We encourage contributions and feedback to help make this a battle-tested library.

A production-grade event sourcing library for **Node.js** and **PostgreSQL**. Type-safe aggregates, event-backed snapshots, GDPR crypto-shredding, projections, transactional outbox, and schema evolution — all in one package.

[![CI](https://github.com/lox-solutions/alvyn/actions/workflows/ci.yml/badge.svg)](https://github.com/lox-solutions/alvyn/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@lox-solutions/alvyn)](https://www.npmjs.com/package/@lox-solutions/alvyn)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why Alvyn?

Most event sourcing libraries for Node.js are either too minimal (just an append/read layer) or too opinionated (forcing a specific framework). Alvyn sits in the middle — it gives you the building blocks for production event-sourced systems without dictating your application architecture.

- **PostgreSQL only** — No abstraction over multiple databases. This lets Alvyn use advisory locks, `FOR UPDATE SKIP LOCKED`, transactional outbox, and schema isolation as first-class features.
- **TypeScript first** — `defineAggregate` and `defineProjection` use curried generics for full type inference. No casting, no `any`.
- **Event-backed snapshots** — Define domain-specific performance snapshots that are stored as generated events in the optimized stream.
- **GDPR built-in** — Per-entity AES-256-GCM envelope encryption with key revocation. Revoking a key makes all PII for that entity cryptographically irrecoverable.
- **CloudEvents v1.0.2** — Every stored event complies with the CloudEvents specification.

## Install

```bash
npm install @lox-solutions/alvyn pg
# or
pnpm add @lox-solutions/alvyn pg
```

`pg` is a peer dependency — you provide the connection pool.

## Quick Start

```typescript
import { Pool } from "pg";
import { EventStore, defineAggregate } from "@lox-solutions/alvyn";

// 1. Create the event store
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const eventStore = new EventStore({ pool });
await eventStore.setup(); // idempotent — safe on every startup

// 2. Define an aggregate
type OrderEvents = {
  OrderPlaced: { customerId: string; total: number };
  OrderShipped: { trackingNumber: string };
};

type OrderState = {
  status: "pending" | "placed" | "shipped";
  total: number;
};

const Order = defineAggregate<OrderState, OrderEvents>()({
  streamPrefix: "Order",
  evolve: {
    OrderPlaced: (state, event) => ({
      ...state,
      status: "placed",
      total: event.data?.total ?? 0,
    }),
    OrderShipped: (state) => ({ ...state, status: "shipped" }),
  },
});

// 3. Use it
const order = await Order.load(eventStore, "order-123");

await Order.append(eventStore, {
  entityId: "order-123",
  expectedVersion: order.version,
  events: [{ type: "OrderShipped", data: { trackingNumber: "TRACK-456" } }],
});
```

## Event-backed snapshots

Use `defineSnapshot` when a calculated state becomes expensive to rebuild from a long event stream. Snapshots are stored as normal generated events in the same stream they optimize, using the reserved event type suffix `Snapshot`.

Snapshots are not necessarily aggregate snapshots. They are independent, domain-defined performance helpers for any state that can be derived from events in one stream. A single aggregate stream can have multiple useful snapshots, and some snapshots can be decoupled from the aggregate's own state:

- `BankAccountBalance` for fast balance checks from `Deposit` and `Withdrawal` events.
- `BankAccountTransactionCount` for fast transaction counting in the same stream.
- `LastBankAccountActivity` for quickly reading the latest relevant activity.

Use a projection instead when the result is a query/read model, needs its own table, combines multiple streams, powers search/filtering, or should be processed asynchronously.

```typescript
import { EventStore, defineSnapshot } from "@lox-solutions/alvyn";

const BankAccountBalance = defineSnapshot<
  { balance: number },
  TransactionEvents
>()({
  streamPrefix: Transaction.streamPrefix,
  snapshotName: "BankAccountBalance",
  every: 50,
  initialState: { balance: 0 },
  evolve: {
    Deposit: (state, event) => ({
      balance: state.balance + Number(event.data?.amount ?? 0),
    }),
    Withdrawal: (state, event) => ({
      balance: state.balance - Number(event.data?.amount ?? 0),
    }),
  },
});

const eventStore = new EventStore({
  pool,
  snapshots: [BankAccountBalance],
});

const balance = await BankAccountBalance.load(eventStore, accountId);
console.log(balance.state.balance);
```

When `BankAccountBalance` is registered on the `EventStore`, matching incoming events update the snapshot synchronously during append and write `BankAccountBalanceSnapshot` once the threshold is reached. Loading finds the latest snapshot event in `Transaction-{accountId}` and replays only later source events; user-supplied events ending in `Snapshot` are rejected so generated snapshot event names cannot collide with domain event names.

## Subscriptions (fan-out)

Alvyn is an event store, so the `events` table **is** the durable, ordered log —
there is no need to bolt a broker on top for in-process consumers. `subscribe()`
observes the store directly: it replays matching history (catch-up) and then
tails live events on the same async iterator, with low-latency delivery via
PostgreSQL `LISTEN/NOTIFY` (and a polling fallback).

Unlike the [outbox](#outbox-vs-subscribe), `subscribe()` is **fan-out**: every
subscriber — e.g. every replica in a replicaset — observes _all_ matching
events independently, each maintaining its own cursor. Resume after a restart by
remembering the last processed `globalPosition` and passing it as `lowerBound`.
Delivery is at-least-once, so consumers must remain idempotent.

```typescript
const ac = new AbortController();

for await (const event of eventStore.subscribe({
  subject: "Order-", // CloudEvents subject == streamId
  recursive: true, // include child subjects (prefix match)
  eventTypes: ["OrderPlaced", "OrderShipped"], // optional type filter
  signal: ac.signal, // stop the stream + release its LISTEN connection
})) {
  await handle(event);
  // Persist event.globalPosition as your cursor for resume-on-restart.
}
```

### Use-case 1 — GraphQL subscription

`subscribe()` returns an `AsyncIterable`, so it maps directly onto a GraphQL
subscription resolver's `asyncIterator`. Each replica streams to its own
connected clients.

```typescript
const resolvers = {
  Subscription: {
    orderEvents: {
      subscribe: (_parent, args, _ctx) => {
        const ac = new AbortController();
        const stream = eventStore.subscribe({
          subject: "Order-",
          recursive: true,
          eventTypes: args.types,
          lowerBound: args.afterPosition
            ? { id: args.afterPosition, type: "exclusive" }
            : undefined,
          signal: ac.signal,
        });
        // graphql-subscriptions / graphql-ws consume any AsyncIterable.
        return mapAsyncIterator(stream, (event) => ({ orderEvents: event }));
      },
    },
  },
};
```

### Use-case 3 — SSE endpoint

The same primitive backs a thin Server-Sent Events handler so other services can
subscribe over HTTP. Each replica streams to its own clients; no broker or outbox
required.

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";

async function observeEvents(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  const lastEventId = req.headers["last-event-id"] as string | undefined;

  for await (const event of eventStore.subscribe({
    subject: "/orders",
    recursive: true,
    lowerBound: lastEventId
      ? { id: lastEventId, type: "exclusive" }
      : undefined,
    signal: ac.signal,
  })) {
    // The SSE `id:` doubles as the resume cursor via the Last-Event-ID header.
    res.write(`id: ${event.globalPosition}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
```

### Use-case 2 — Bridge to NATS (outbox)

<a id="outbox-vs-subscribe"></a>
When you need each event published **once across the fleet** to an external
broker (e.g. NATS), `subscribe()`'s fan-out is the wrong shape — every replica
would publish a duplicate. Use the **transactional outbox** instead: it is a
competing-consumer relay (`FOR UPDATE SKIP LOCKED`) where exactly one replica
processes each entry, with at-least-once delivery atomic to the event write.

```typescript
// Producer: opt in by setting outboxTopics on append.
await eventStore.append({
  streamId: "Order-123",
  expectedVersion: 0,
  events: [{ type: "OrderPlaced", data: { total: 100 } }],
  outboxTopics: ["orders"],
});

// Relay (run on every replica; SKIP LOCKED ensures each event is published once):
await eventStore.processOutbox(async (entries) => {
  for (const entry of entries) {
    await nats.publish(entry.topic, JSON.stringify(entry.payload));
  }
});
```

**When to use which:** `subscribe()` for in-process fan-out (read models,
GraphQL, SSE — use-cases 1 & 3); the outbox for bridging to an external broker
where each event must be published once (use-case 2).

## Features

| Feature                  | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| **Aggregates**           | `defineAggregate` with full TypeScript inference and OCC                     |
| **Subscriptions**        | `subscribe()` fan-out async iterator: catch-up + live tail via LISTEN/NOTIFY |
| **Projections**          | `defineProjection` for typed read models with checkpoint tracking            |
| **Crypto-Shredding**     | Per-entity AES-256-GCM envelope encryption for GDPR compliance               |
| **Transactional Outbox** | At-least-once delivery to external systems, atomic with event writes         |
| **Schema Evolution**     | Read-time upcasters that transform old event shapes without migrations       |
| **CloudEvents**          | All events comply with CloudEvents v1.0.2 specification                      |

## Documentation

Full documentation is available at **[lox-solutions.github.io/alvyn](https://lox-solutions.github.io/alvyn)**.

- [Getting Started](https://lox-solutions.github.io/alvyn/docs)
- [Aggregates](https://lox-solutions.github.io/alvyn/docs/aggregates)
- [Crypto-Shredding & GDPR](https://lox-solutions.github.io/alvyn/docs/crypto-shredding)
- [Projections & Outbox](https://lox-solutions.github.io/alvyn/docs/projections)
- [Schema Evolution](https://lox-solutions.github.io/alvyn/docs/schema-evolution)
- [API Reference](https://lox-solutions.github.io/alvyn/docs/api-reference)
- [Database Schema](https://lox-solutions.github.io/alvyn/docs/database-schema)

## Requirements

- Node.js >= 18
- PostgreSQL >= 14
- `pg` ^8 (peer dependency)

## Parallel load tests

The opt-in load-test harness models multiple independent application replicas
using Node.js child processes. Each worker owns its own `pg.Pool` and
`EventStore`, while all workers share one PostgreSQL primary and an isolated
schema in a PostgreSQL 16 Testcontainers instance. This exercises parallel
append/load traffic, hot-stream optimistic concurrency, and replay of seeded
history; it does not provision PostgreSQL read replicas, failover, or an HA
cluster.

Docker must be running because the harness starts PostgreSQL through
[Testcontainers](https://testcontainers.com/). The load run is deliberately
separate from the normal Vitest suite and is never included in `pnpm test` or
coverage runs.

### How the workload works

The harness creates deterministic append-only event streams named
`load-test-stream-0`, `load-test-stream-1`, and so on. Each stream represents a
different aggregate or entity history. Every worker receives its own process,
connection pool, and `EventStore`, but all workers write to the same streams in
the shared PostgreSQL database.

There are two kinds of streams in a run:

- **Hot streams** are the first `--hot-streams` streams. Most generated
  operations (approximately 75%) target this small subset, which makes several
  workers append to the same histories at the same time. Each hot-stream
  append reads the current version and writes with that version as
  `expectedVersion`. Concurrent writers can therefore observe a stale version,
  produce an optimistic-concurrency conflict, and retry through Alvyn's normal
  retry path. This is how the scenario exercises per-stream advisory-lock
  serialization and OCC behavior.
- **Cold streams** are the remaining streams. Operations are distributed
  across them, so they generally have less contention and represent traffic
  spread across many independent entities. Set `--hot-streams 0` to run without
  a hot subset, or set it equal to `--streams` when all streams should be
  contention-heavy.

The history and live workload are separate phases:

- `--history` controls how many existing events are created **per stream**
  before worker traffic starts. For example, `--streams 100 --history 10000`
  creates 1,000,000 existing events. This simulates an application that has
  been running for a long time and makes replay/load operations work against
  realistic stream lengths. History is written in bounded `--batch-size`
  append calls, so increasing it does not require keeping the whole history in
  memory. Seed events are not worker operations.
- `--seed` is a reproducibility seed, not the history size. It determines the
  generated stream choices, append-versus-load choices, and logical event
  tokens. Reusing the same seed and configuration produces the same logical
  workload, which makes reports easier to compare across code changes. Change
  it to generate a different deterministic workload.

During the live phase, `--operations` is the number of operations **per
worker**, not the total for the run. `--append-percent` chooses the approximate
share of those operations that append; the rest load a stream. One append
operation writes `--batch-size` events. For example, 4 workers with 100
operations each and `--append-percent 60 --batch-size 2` attempt 400 live
operations, roughly 240 appends, and roughly 480 live events. The exact split
is deterministic and can differ slightly from the percentage because each
operation is generated individually.

### Show live progress

Pass `--verbose` when you want to see where a long run is spending its time:

```bash
pnpm test:load -- --history 10000 --operations 1000 --verbose
```

Verbose mode reuses one terminal line instead of printing a new line for every
batch or operation. It shows PostgreSQL startup, history-seeding counts, live
worker totals, and verification progress; the final report is printed normally
after the progress line. The same option can be enabled with
`ALVYN_LOAD_VERBOSE=true`. Without `--verbose`, the harness keeps the console
quiet until the final report.

### Run a smoke scenario

```bash
pnpm test:load -- \
  --workers 2 \
  --pool-size 2 \
  --streams 4 \
  --hot-streams 2 \
  --history 100 \
  --operations 50 \
  --append-percent 60 \
  --batch-size 2 \
  --max-retries 20 \
  --output .load-smoke-report.json
```

The command uses deterministic stream selection and event tokens for a given
`--seed`, so the same workload parameters can be compared across changes.

### Run a large-history scenario

```bash
pnpm test:load -- \
  --workers 4 \
  --pool-size 8 \
  --streams 100 \
  --hot-streams 4 \
  --history 10000 \
  --operations 1000 \
  --append-percent 60 \
  --batch-size 10 \
  --max-retries 30 \
  --seed 42 \
  --output load-report.json
```

History is seeded in bounded append batches before the measured phase. The
post-run verifier reads streams in pages, checks contiguous versions and event
ordering, reconciles every successful logical append, and rejects missing or
duplicate event tokens. Worker crashes, setup failures, exhausted writes, and
integrity mismatches return a non-zero exit code.

### Configuration

Every numeric option can be supplied as a command-line option or environment
variable; command-line values take precedence. `--verbose` is a boolean flag
and can also be enabled with `ALVYN_LOAD_VERBOSE=true`.

| Option             | Environment variable        | Description                                                           |
| ------------------ | --------------------------- | --------------------------------------------------------------------- |
| `--workers`        | `ALVYN_LOAD_WORKERS`        | Number of independent application workers.                            |
| `--pool-size`      | `ALVYN_LOAD_POOL_SIZE`      | Maximum pool size per worker and coordinator.                         |
| `--streams`        | `ALVYN_LOAD_STREAMS`        | Total number of streams; the first hot-streams belong to the hot set. |
| `--hot-streams`    | `ALVYN_LOAD_HOT_STREAMS`    | Number of streams receiving most contention-heavy operations.         |
| `--history`        | `ALVYN_LOAD_HISTORY`        | Existing seed events created per stream before live traffic.          |
| `--operations`     | `ALVYN_LOAD_OPERATIONS`     | Number of measured operations executed by each worker.                |
| `--append-percent` | `ALVYN_LOAD_APPEND_PERCENT` | Approximate share of live operations that append instead of load.     |
| `--batch-size`     | `ALVYN_LOAD_BATCH_SIZE`     | Number of events written by each append operation and seed batch.     |
| `--max-retries`    | `ALVYN_LOAD_MAX_RETRIES`    | Maximum OCC retries before a required append is reported as failed.   |
| `--seed`           | `ALVYN_LOAD_SEED`           | Reproducibility seed for choices, tokens, and event metadata.         |
| `--output`         | `ALVYN_LOAD_OUTPUT`         | Optional path for the machine-readable JSON report.                   |
| `--verbose`        | `ALVYN_LOAD_VERBOSE`        | Rewrite one console line with live phase and worker progress.         |

The human-readable report includes total duration, effective connection count,
append/load successes and failures, event counts, OCC conflicts and retries,
throughput, and p50/p95/p99 latency for each operation class and overall. It
also includes per-worker counters and verification totals. Latency and
throughput are diagnostic data rather than fixed performance budgets, so
machine-dependent performance variation does not fail an otherwise correct
run.

## Contributing

Alvyn is in beta and we actively welcome contributions. Whether it's bug reports, feature requests, documentation improvements, or code — all contributions help make this library more robust.

```bash
# Clone and install
git clone https://github.com/lox-solutions/alvyn.git
cd alvyn
pnpm install

# Run integration tests (requires Docker for PostgreSQL via Testcontainers)
pnpm test

# Run with coverage
pnpm test:coverage
```

The test suite uses [Testcontainers](https://testcontainers.com/) to spin up PostgreSQL instances automatically — you just need Docker running.

Please open an [issue](https://github.com/lox-solutions/alvyn/issues) or [pull request](https://github.com/lox-solutions/alvyn/pulls) on GitHub.

## License

[MIT](LICENSE)
