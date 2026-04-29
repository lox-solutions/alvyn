# API Reference

Complete reference for the `EventStore` class, all exported types, and error classes.

> **Related:** [Event Store Overview](../event-store.md) | [Aggregates](./aggregates.md) | [Database Schema](./database-schema.md)

---

## EventStore Class

### Constructor

```typescript
import { EventStore } from "@repo/event-store";

new EventStore(config: EventStoreConfig)
```

```typescript
interface EventStoreConfig {
  /** pg Pool instance -- the library does NOT create or manage the pool */
  pool: Pool;
  /** PostgreSQL schema name for all event store tables (default: "event_store") */
  schema?: string;
  /** Master encryption key (hex-encoded, 256-bit / 64 hex chars). Required only for crypto-shredding. */
  masterEncryptionKey?: string;
  /** Default CloudEvents source URI-reference (e.g. "urn:my-app:event-store"). Can be overridden per event. */
  defaultSource?: string;
}
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pool` | `Pool` | Yes | PostgreSQL connection pool (caller manages lifecycle) |
| `schema` | `string` | No | PostgreSQL schema name (default: `"event_store"`) |
| `masterEncryptionKey` | `string` | No | 256-bit hex key (64 chars) for envelope encryption |
| `defaultSource` | `string` | No | CloudEvents `source` URI-reference applied to all events unless overridden |

The schema name is validated against `/^[a-z_][a-z0-9_]{0,62}$/`. Invalid names throw `InvalidSchemaNameError`.

---

### Lifecycle

#### `setup(): Promise<void>`

Runs idempotent schema migrations (`CREATE TABLE IF NOT EXISTS`). Safe on every startup. **Must be called before any other method.**

Throws `EventStoreNotInitializedError` if other methods are called before `setup()`.

---

### Stream Operations

#### `append<T>(input: AppendInput<T>, options?: { client?: PoolClient }): Promise<AppendResult>`

Appends events to a stream within an ACID transaction.

```typescript
const result = await eventStore.append({
  streamId: "Order-123",
  expectedVersion: 5,
  events: [
    {
      type: "OrderShipped",
      data: { trackingNumber: "TRACK-456" },
      extensions: { actorid: "user-789", correlationid: "cmd-abc" },
      schemaVersion: 1,
      encryptedFields: [],
      cryptoKeyId: undefined,
    },
  ],
  outboxTopics: ["orders"],
});
```

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `streamId` | `string` | Target stream identifier |
| `expectedVersion` | `number` | `-1` = new stream, `0` = no check, `N` = exact version |
| `events` | `AppendEventInput<T>[]` | Events to append |
| `outboxTopics` | `string[]` | Optional: topics for transactional outbox |

**Options:** Pass `{ client }` to use an existing transaction (from `withTransaction()`).

**Returns:** `AppendResult` with `streamId`, `fromVersion`, `toVersion`, `globalPositions[]`.

**Throws:** `OptimisticConcurrencyError`, `CryptoKeyRevokedError`.

---

#### `load<T>(streamId: string): Promise<ReplayedEvent<T>[]>`

Loads all events for a stream from version 1. Handles decryption and upcasting automatically.

---

#### `loadFrom<T>(streamId: string, fromVersion: number): Promise<ReplayedEvent<T>[]>`

Loads events starting from a specific version.

---

#### `loadWithSnapshot<T>(streamId: string): Promise<{ snapshot: Snapshot<T> | null; events: ReplayedEvent<T>[] }>`

Loads the snapshot (if any) plus events after the snapshot version. Most efficient way to rebuild aggregate state.

```typescript
const { snapshot, events } = await eventStore.loadWithSnapshot("Order-123");
```

---

#### `listStreams(options?: ListStreamsOptions): Promise<string[]>`

Lists distinct stream IDs, optionally filtered by prefix. Uses the B-tree index on `(stream_id, stream_version)` for efficient prefix scans.

```typescript
// List all streams (default limit: 100)
const allStreams = await eventStore.listStreams();

// List streams for a specific aggregate
const orderStreams = await eventStore.listStreams({ prefix: "Order", limit: 50 });
// => ["Order-abc123", "Order-def456", ...]
```

**Options:**

| Field | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | – | Stream ID prefix (e.g. `"AgentRun"`). The separator `"-"` is appended automatically. |
| `limit` | `number` | `100` | Maximum number of stream IDs to return. |

**Returns:** Array of full stream IDs, ordered descending by stream ID.

**When to use:** Suitable for low-to-moderate frequency queries such as listing aggregate instances in admin views or background jobs. For high-frequency queries or complex filtering (by status, date range, ownership, etc.), build a [projection-based read model](./projections.md) instead.

---

### Snapshots

#### `saveSnapshot<T>(input: SaveSnapshotInput<T>): Promise<void>`

Saves a snapshot for a stream. Upserts -- one snapshot per stream.

```typescript
await eventStore.saveSnapshot({
  streamId: "Order-123",
  streamVersion: 100,
  snapshotType: "Order",
  data: { status: "shipped", total: 99.99 },
});
```

#### `deleteSnapshot(streamId: string): Promise<void>`

Deletes the snapshot for a stream.

---

### Crypto / GDPR

#### `createCryptoKey(keyId: string): Promise<void>`

Creates a per-entity AES-256 encryption key. Idempotent -- no-op if key already exists.

**Throws:** `MasterKeyRequiredError` if no `masterEncryptionKey` was configured.

#### `revokeKey(keyId: string): Promise<void>`

Revokes a crypto key (GDPR erasure). Encrypted events become tombstones on read. Deletes snapshots for affected streams.

**Throws:** `MasterKeyRequiredError`, `CryptoKeyNotFoundError`.

See [Crypto-Shredding](./crypto-shredding.md) for details.

---

### Outbox

#### `pollOutbox(limit?: number): Promise<OutboxEntry[]>`

Polls pending outbox entries (default limit: 100). Uses `FOR UPDATE SKIP LOCKED` for replica-safe concurrent processing.

#### `markOutboxProcessed(ids: bigint[]): Promise<void>`

Marks outbox entries as processed.

See [Projections & Outbox](./projections.md) for details.

---

### Projections

#### `runProjection(projection: Projection, batchSize?: number): Promise<number>`

Processes the next batch of events for a projection (default batch: 500). Returns the count of events processed. Accepts both raw `Projection` objects and `ProjectionHandle` objects returned by `defineProjection`.

See [Projections & Outbox](./projections.md) for details.

---

### `defineProjection<TEvents>()(definition): ProjectionHandle`

Builder function for typed projections. Mirrors the `defineAggregate` pattern. See [Projections — `defineProjection` Builder](./projections.md#defineprojection-builder-recommended) for full documentation.

```typescript
import { defineProjection } from "@repo/event-store";

const orderProjection = defineProjection<OrderEvents>()({
  projectionName: "order-summary",
  streamPrefix: "Order",
  handlers: {
    OrderPlaced: async (data, ctx) => { /* typed handler */ },
  },
});
```

---

### Upcasters

#### `registerUpcaster(upcaster: Upcaster): void`

Registers a single schema evolution transformer.

#### `registerUpcasters(upcasters: Upcaster[]): void`

Registers multiple upcasters at once.

See [Schema Evolution](./schema-evolution.md) for details.

---

### Transactions

#### `withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>`

Executes a function within a PostgreSQL transaction. Useful for coordinating event store writes with other database operations.

```typescript
await eventStore.withTransaction(async (client) => {
  await eventStore.append(
    {
      streamId: "Order-123",
      expectedVersion: 5,
      events: [{ type: "OrderPlaced", data: { total: 99.99 } }],
    },
    { client },
  );
  await client.query("INSERT INTO audit_log ...", [...]);
});
```

---

## Type Definitions

### CloudEvents Context Types

```typescript
/** CloudEvents v1.0.2 required context attributes */
interface CloudEventRequiredAttributes {
  id: string;                        // Unique event ID: "{streamId}/{streamVersion}"
  source: string;                    // URI-reference identifying the event source
  specversion: string;               // Always "1.0"
  type: string;                      // Event type name (e.g. "OrderPlaced")
}

/** CloudEvents v1.0.2 optional context attributes */
interface CloudEventOptionalAttributes {
  datacontenttype?: string;          // Always "application/json" for this library
  dataschema?: string;               // Optional URI to the data schema
  subject?: string;                  // Stream ID (e.g. "Order-123")
  time?: string;                     // ISO 8601 timestamp
}

/** Extension attributes stored in the `extensions` JSONB column */
interface CloudEventExtensions {
  correlationid?: string;            // Chain correlation across services
  causationid?: string;              // ID of causing event/command
  actorid?: string;                  // User/system actor
  schemaversion?: number;            // For upcasting (default: 1)
  [key: string]: unknown;            // Arbitrary additional extensions
}

/** Full CloudEvents context (required + optional + extensions) */
type CloudEventContext = CloudEventRequiredAttributes &
  CloudEventOptionalAttributes & {
    extensions: CloudEventExtensions;
  };
```

### Event Types

```typescript
interface StoredEvent<T = unknown> extends CloudEventRequiredAttributes, CloudEventOptionalAttributes {
  globalPosition: bigint;
  streamId: string;
  streamVersion: number;
  type: string;                      // Event type name (CloudEvents `type`)
  data: T;
  extensions: CloudEventExtensions;  // Extension attributes
  createdAt: Date;
}

interface TombstonedEvent extends CloudEventRequiredAttributes, CloudEventOptionalAttributes {
  globalPosition: bigint;
  streamId: string;
  streamVersion: number;
  type: string;                      // Event type name (CloudEvents `type`)
  data: null;                        // PII shredded -- irrecoverable
  extensions: CloudEventExtensions;  // Extensions are NOT encrypted
  createdAt: Date;
  tombstoned: true;
}

/** An event returned from load(). Either fully resolved or a tombstone. */
type ReplayedEvent<T = unknown> = StoredEvent<T> | TombstonedEvent;
```

### Append Types

```typescript
interface AppendEventInput<T = unknown> {
  type: string;                      // Event type name (CloudEvents `type`)
  data: T;
  extensions?: Partial<CloudEventExtensions>;
  source?: string;                   // Override defaultSource for this event
  encryptedFields?: string[];        // Dot-paths to PII fields
  cryptoKeyId?: string;              // Entity crypto key ID
  schemaVersion?: number;            // Default: 1
}

interface AppendInput<T = unknown> {
  streamId: string;
  expectedVersion: number;           // -1 = new, 0 = no check, N = exact
  events: AppendEventInput<T>[];
  outboxTopics?: string[];           // Topics for transactional outbox
}

interface AppendResult {
  streamId: string;
  fromVersion: number;               // First new stream_version written
  toVersion: number;                 // Last new stream_version written
  globalPositions: bigint[];         // Global positions assigned to each event
}
```

### Snapshot Types

```typescript
interface Snapshot<T = unknown> {
  streamId: string;
  streamVersion: number;
  snapshotType: string;
  data: T;
  createdAt: Date;
}

interface SaveSnapshotInput<T = unknown> {
  streamId: string;
  streamVersion: number;
  snapshotType: string;
  data: T;
}
```

### Stream Discovery Types

```typescript
interface ListStreamsOptions {
  /** Stream ID prefix (e.g. "AgentRun"). The separator "-" is appended automatically. */
  prefix?: string;
  /** Maximum number of stream IDs to return (default: 100) */
  limit?: number;
}
```

### Upcaster Type

```typescript
interface Upcaster<TIn = unknown, TOut = unknown> {
  eventType: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  upcast(data: TIn): TOut;
}
```

### Projection Type

```typescript
interface Projection {
  projectionName: string;
  handle(event: StoredEvent, client: PoolClient): Promise<void>;
}
```

### Projection Builder Types

```typescript
interface ProjectionDefinition<TEvents extends EventMap> {
  projectionName: string;
  streamPrefix: string;
  handlers: {
    [K in keyof TEvents & string]?: (data: TEvents[K], ctx: ProjectionHandlerContext) => Promise<void>;
  };
}

interface ProjectionHandlerContext {
  entityId: string;        // Entity ID (prefix stripped from stream ID)
  streamId: string;        // Full stream ID
  globalPosition: bigint;  // Event's global position
  streamVersion: number;   // Event's stream version
  createdAt: Date;         // Event's creation timestamp
  client: PoolClient;      // Transactional PoolClient
}

interface ProjectionHandle {
  readonly projectionName: string;
  readonly streamPrefix: string;
  handle(event: StoredEvent, client: PoolClient): Promise<void>;
}
```

### Outbox Type

```typescript
interface OutboxEntry {
  id: bigint;
  eventGlobalPosition: bigint;
  topic: string;
  payload: unknown;
  createdAt: Date;
}
```

### Transaction Type

```typescript
interface TransactionContext {
  client: PoolClient;
}
```

### Aggregate Types

```typescript
type EventMap = Record<string, unknown>;

type AggregateEventInput<TEvents extends EventMap> = {
  [K in keyof TEvents & string]: {
    type: K;
    data: TEvents[K];
    extensions?: Partial<CloudEventExtensions>;
    schemaVersion?: number;
  };
}[keyof TEvents & string];

interface AggregateInstance<TState> {
  state: TState;                     // Current state after replay
  version: number;                   // Current stream version
  exists: boolean;                   // Has at least one event
  streamId: string;                  // Full stream ID
}

interface EncryptionConfig<TEvents extends EventMap> {
  cryptoKeyId: (entityId: string) => string;
  encryptedFields: Partial<Record<keyof TEvents & string, string[]>>;
}

interface SnapshotConfig {
  every: number;                     // Auto-snapshot every N events
}
```

---

## Error Reference

All errors extend `Error` and have a `name` property matching the class name for `instanceof` checks.

### `OptimisticConcurrencyError`

Thrown when `expectedVersion` does not match the stream's current version.

| Property | Type | Description |
|---|---|---|
| `streamId` | `string` | The conflicting stream |
| `expectedVersion` | `number` | What the caller expected |
| `actualVersion` | `number` | The stream's actual version |

**Recovery:** Reload the stream and retry.

### `StreamNotFoundError`

Thrown when loading a stream that does not exist and the caller explicitly required existence.

| Property | Type |
|---|---|
| `streamId` | `string` |

### `CryptoKeyRevokedError`

Thrown when attempting to encrypt **new** events with a revoked key. Not thrown during reads -- revoked keys produce tombstones instead.

| Property | Type |
|---|---|
| `keyId` | `string` |

### `CryptoKeyNotFoundError`

Thrown when a crypto key is not found in the key store.

| Property | Type |
|---|---|
| `keyId` | `string` |

### `MasterKeyRequiredError`

Thrown when crypto operations are attempted but no `masterEncryptionKey` was provided in the config.

### `EventStoreNotInitializedError`

Thrown when any method is called before `setup()`.

### `InvalidSchemaNameError`

Thrown when the schema name does not match `/^[a-z_][a-z0-9_]{0,62}$/`.

| Property | Type |
|---|---|
| `schemaName` | `string` |
