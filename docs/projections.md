# Projections & Outbox

Projections build **read models** from the global event stream. The transactional outbox guarantees **at-least-once delivery** of events to external systems. Both patterns are built into the event store.

> **Related:** [Event Store Overview](../event-store.md) | [Database Schema](./database-schema.md) | [API Reference](./api-reference.md)

---

## Projections

### Overview

A projection reads events sequentially from the global stream (ordered by `global_position`) and transforms them into a read-optimized data structure (read model). Each projection tracks its own checkpoint and processes events independently.

### Defining a Projection

Implement the `Projection` interface. The `handle` function receives a `StoredEvent` and a `PoolClient` — use the provided client for all database writes to ensure atomicity with the projection checkpoint:

```typescript
import type { Projection, StoredEvent } from "@repo/event-store";
import type { PoolClient } from "pg";

const orderSummaryProjection: Projection = {
  projectionName: "order-summary",
  async handle(event: StoredEvent, client: PoolClient) {
    switch (event.type) {
      case "OrderPlaced":
        await client.query(
          `INSERT INTO order_summaries (stream_id, total, status)
           VALUES ($1, $2, 'placed')`,
          [event.streamId, (event.data as { total: number }).total],
        );
        break;
      case "OrderShipped":
        await client.query(
          `UPDATE order_summaries SET status = 'shipped' WHERE stream_id = $1`,
          [event.streamId],
        );
        break;
    }
  },
};
```

The `Projection` interface:

```typescript
interface Projection {
  projectionName: string; // Unique identifier for checkpoint tracking
  handle(event: StoredEvent, client: PoolClient): Promise<void>;
}
```

> **Important:** The `client` parameter is the same `PoolClient` that holds the transaction for the checkpoint update. If you use this client for your SQL writes, the read model update and the checkpoint advance are **atomic** — if anything fails, both roll back. This gives exactly-once projection semantics within a single database.

### `defineProjection` Builder (Recommended)

For typed projections tied to an event-sourced aggregate, use `defineProjection`. It mirrors the `defineAggregate` pattern — same curried function for type inference, automatic stream prefix filtering, entity ID extraction, and typed event handlers:

```typescript
import { defineProjection } from "@repo/event-store";

type OrderEvents = {
  OrderPlaced: { customerId: string; total: number };
  OrderShipped: { trackingNumber: string };
};

const orderProjection = defineProjection<OrderEvents>()({
  projectionName: "order-summary",
  streamPrefix: "Order",

  handlers: {
    OrderPlaced: async (data, ctx) => {
      // `data` is fully typed as { customerId: string; total: number }
      // `ctx.client` is the transactional PoolClient
      // `ctx.entityId` is the ID extracted from the stream (e.g. "123" from "Order-123")
      await ctx.client.query(
        `INSERT INTO order_summaries (id, total, status) VALUES ($1, $2, 'placed')`,
        [ctx.entityId, data.total],
      );
    },
    OrderShipped: async (_data, ctx) => {
      await ctx.client.query(
        `UPDATE order_summaries SET status = 'shipped' WHERE id = $1`,
        [ctx.entityId],
      );
    },
    // Handlers that are omitted are silently skipped (forward-compatible)
  },
});

await eventStore.runProjection(orderProjection, 500);
```

The builder automatically:

- **Filters by stream prefix** — events from other aggregates are skipped without calling any handler
- **Extracts the entity ID** from the stream ID (e.g. `"Order-123"` → `"123"`)
- **Provides typed `data`** — each handler receives the correctly-typed event payload, no manual casting
- **Passes the transactional `PoolClient`** via `ctx.client` for atomic writes

**`ProjectionHandlerContext`:**

```typescript
interface ProjectionHandlerContext {
  entityId: string; // Entity ID (prefix stripped)
  streamId: string; // Full stream ID
  globalPosition: bigint; // Event's global position
  streamVersion: number; // Event's stream version
  createdAt: Date; // Event's creation timestamp
  client: PoolClient; // Transactional PoolClient
}
```

### Running Projections

Call `runProjection()` to process the next batch of events:

```typescript
// Process next batch (default: 500 events)
const processed = await eventStore.runProjection(orderSummaryProjection, 500);
// processed -> number of events handled in this batch
```

**Catch-up loop** -- process until fully caught up:

```typescript
let count: number;
do {
  count = await eventStore.runProjection(orderSummaryProjection, 500);
} while (count > 0);
```

**Continuous processing** -- run on a schedule:

```typescript
// Run every 5 seconds
setInterval(async () => {
  try {
    await eventStore.runProjection(orderSummaryProjection, 500);
  } catch (error) {
    console.error("Projection failed:", error);
  }
}, 5000);
```

### How Projections Work Internally

1. The projection's checkpoint is stored in the `projections` table (`last_position` column).
2. On each `runProjection()` call:
   - Upserts the checkpoint row (idempotent)
   - Reads `last_position` with `FOR UPDATE` (row-level lock)
   - Fetches the next batch: `SELECT ... WHERE global_position > last_position ORDER BY global_position ASC LIMIT batchSize`
   - Calls `handle(event)` for each event sequentially
   - Updates `last_position` to the last processed event's `global_position`
3. Everything runs within a single transaction -- if the handler fails, the checkpoint is not advanced (crash recovery).

### Important Notes

- Projections read **plain event data only** (no decryption). They are designed for building read models from non-PII data.
- Each projection name must be unique. Multiple instances with the same name will contend on the same checkpoint row.
- The `handle` function receives `StoredEvent` (not `ReplayedEvent`) -- there are no tombstones in projection processing.

---

### Real-World Example: Agent Run Read Model

This project uses a CQRS projection to maintain a denormalized `agent_run_read_model` table from the event-sourced `AgentRun` aggregate. This replaces N+1 aggregate loading with a single indexed Prisma query.

#### 1. Read Model Table (Prisma Schema)

```prisma
model AgentRunReadModel {
    id               String         @id
    status           AgentRunStatus @default(PENDING)
    taskDescription  String
    llmConnectionId  String
    createdBy        String
    // ... other fields
    lastEventPosition BigInt @default(0)
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    @@index([createdBy])
    @@index([status])
    @@index([createdAt])
    @@map("agent_run_read_model")
}
```

#### 2. Projection Definition (`backend/domains/agent-run/projection.ts`)

```typescript
import { defineProjection } from "@repo/event-store";
import type { AgentRunEvents } from "./aggregate";

export const agentRunProjection = defineProjection<AgentRunEvents>()({
  projectionName: "agent-run-read-model",
  streamPrefix: "AgentRun",

  handlers: {
    AgentRunCreated: async (data, ctx) => {
      // `data` is typed as AgentRunEvents["AgentRunCreated"]
      await ctx.client.query(
        `INSERT INTO "agent_run_read_model" ("id", "status", "taskDescription", ...)
         VALUES ($1, 'PENDING', $2, ...)
         ON CONFLICT ("id") DO NOTHING`,
        [ctx.entityId, data.taskDescription, ...],
      );
    },
    AgentRunStarted: async (data, ctx) => {
      // UPDATE status = 'RUNNING' ...
    },
    AgentRunCompleted: async (data, ctx) => {
      // UPDATE status = 'COMPLETED' ...
    },
    // ... other event types
  },
});
```

Key patterns:

- **`defineProjection<AgentRunEvents>()`** — same curried pattern as `defineAggregate`, gives full type inference on handler `data` parameters
- **Automatic prefix filtering** — events from other aggregates are skipped without calling any handler
- **`ctx.entityId`** — automatically extracted from stream ID (e.g. `"abc123"` from `"AgentRun-abc123"`)
- **`ctx.client`** — transactional `PoolClient` ensures atomicity with the checkpoint
- **`ON CONFLICT DO NOTHING`** — makes the create handler idempotent

#### 3. Continuous Processing (`backend/lib/core/projection-runner.ts`)

```typescript
import { createProjectionRunner } from "backend/lib/core/projection-runner";
import { agentRunProjection } from "backend/domains/agent-run/projection";

const runner = createProjectionRunner();
runner.register(agentRunProjection);
await runner.start(); // initial catch-up + polling every 2 seconds
```

This is registered at application startup in `src/instrumentation.ts`.

#### 4. Querying the Read Model

```typescript
// Single indexed query — replaces N+1 aggregate loading
const runs = await prisma.agentRunReadModel.findMany({
  where: { createdBy: userId },
  orderBy: { createdAt: "desc" },
  take: limit,
});
```

#### 5. Consistency Trade-offs

| Operation                   | Source                                        | Consistency           |
| --------------------------- | --------------------------------------------- | --------------------- |
| `agentRuns` (list query)    | Read model (Prisma)                           | Eventually consistent |
| `agentRun` (single query)   | Event store (aggregate replay)                | Strongly consistent   |
| `createAgentRun` (mutation) | Event store (write) + returns aggregate state | Strongly consistent   |
| `cancelAgentRun` (mutation) | Event store (write) + returns aggregate state | Strongly consistent   |

Mutations return state from the event store directly (not the read model) to guarantee read-your-writes consistency. The list query uses the eventually-consistent read model for performance.

---

## Transactional Outbox

### Overview

The outbox pattern solves the dual-write problem: how to atomically update the event store and notify external systems. Outbox rows are inserted **in the same transaction** as the events, guaranteeing consistency.

### How It Works

```
1. Begin Transaction
   |
   +-> INSERT INTO events ...
   +-> INSERT INTO outbox ...     (same transaction)
   |
2. Commit Transaction
   |
3. Relay Worker (separate process)
   |
   +-> SELECT ... FOR UPDATE SKIP LOCKED  (poll pending entries)
   +-> Dispatch to message broker
   +-> UPDATE outbox SET processed_at = now()
```

### Publishing to the Outbox

Specify `outboxTopics` when appending events:

```typescript
await eventStore.append({
  streamId: "Order-123",
  expectedVersion: 0,
  events: [{ type: "OrderPlaced", data: { total: 99.99 } }],
  outboxTopics: ["orders", "notifications"],
  // Creates one outbox entry per topic per event
});
```

Or through the aggregate builder:

```typescript
await Order.append(eventStore, "order-123", {
  expectedVersion: order.version,
  events: [{ type: "OrderPlaced", data: { total: 99.99 } }],
  outboxTopics: ["orders"],
});
```

### Outbox Payload Format (CloudEvents v1.0.2)

Each outbox entry contains a fully CloudEvents v1.0.2 compliant JSON payload. Extension attributes are placed at the top level of the envelope:

```json
{
  "specversion": "1.0",
  "type": "OrderPlaced",
  "source": "urn:code-buddies:event-store",
  "id": "Order-123/1",
  "time": "2026-03-12T10:00:00.000Z",
  "datacontenttype": "application/json",
  "subject": "Order-123",
  "correlationid": "cmd-abc",
  "actorid": "user-789",
  "schemaversion": 1,
  "data": { "customerId": "cust-1", "total": 99.99 }
}
```

### Polling and Dispatching

Build a relay worker that polls and dispatches:

```typescript
async function relayOutbox() {
  // 1. Poll pending entries (uses FOR UPDATE SKIP LOCKED)
  const entries = await eventStore.pollOutbox(100);

  if (entries.length === 0) return;

  // 2. Dispatch to external system
  for (const entry of entries) {
    await messageBroker.publish(entry.topic, entry.payload);
  }

  // 3. Mark as processed
  await eventStore.markOutboxProcessed(entries.map((e) => e.id));
}

// Run on a schedule
setInterval(relayOutbox, 2000);
```

### OutboxEntry Type

```typescript
interface OutboxEntry {
  id: bigint; // Unique outbox row ID
  eventGlobalPosition: bigint; // Reference to events.global_position
  topic: string; // Message topic/channel
  payload: unknown; // CloudEvents v1.0.2 JSON payload
  createdAt: Date;
}
```

### Replica Safety

The outbox uses `SELECT ... FOR UPDATE SKIP LOCKED` for polling. This means:

- **Multiple relay workers** can run concurrently across replicas
- Each worker gets a **disjoint set** of entries -- no double-processing
- If a worker crashes mid-batch, the entries are automatically unlocked when the transaction rolls back
- Delivery guarantee: **at-least-once** (entries may be redelivered if the worker crashes after dispatching but before marking as processed)
