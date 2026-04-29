# Database Schema

All event store tables live in a dedicated PostgreSQL schema (default: `event_store`), isolated from Prisma-managed application tables. Migrations are idempotent -- safe to call on every application startup.

> **Related:** [Event Store Overview](../event-store.md) | [API Reference](./api-reference.md)

---

## Schema Isolation

The event store uses its own PostgreSQL schema (not to be confused with a "schema" in the data modeling sense). This keeps event store tables completely separate from application tables managed by Prisma.

```sql
CREATE SCHEMA IF NOT EXISTS event_store;
```

The schema name defaults to `event_store` but can be configured:

```typescript
const eventStore = new EventStore({
  pool,
  schema: "my_custom_schema",  // Must match /^[a-z_][a-z0-9_]{0,62}$/
});
```

The schema name is validated against `/^[a-z_][a-z0-9_]{0,62}$/` to prevent SQL injection (lowercase letters, underscores, max 63 characters).

---

## Tables

### `events`

The core append-only event log. Every domain event is stored as a row. Columns are aligned with the **CloudEvents v1.0.2** specification — required and optional context attributes have dedicated columns, while extension attributes are stored in a `extensions` JSONB column.

```sql
CREATE TABLE IF NOT EXISTS {schema}.events (
  global_position  BIGSERIAL        NOT NULL,
  stream_id        TEXT             NOT NULL,
  stream_version   INTEGER          NOT NULL,
  id               TEXT             NOT NULL,
  source           TEXT             NOT NULL,
  specversion      TEXT             NOT NULL,
  event_type       TEXT             NOT NULL,
  subject          TEXT             NOT NULL,
  time             TIMESTAMPTZ      NOT NULL,
  datacontenttype  TEXT             NOT NULL,
  data             JSONB            NOT NULL,
  extensions       JSONB            NOT NULL,
  encrypted_data   JSONB            NULL,
  crypto_key_id    TEXT             NULL,
  schema_version   INTEGER          NOT NULL,
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),

  PRIMARY KEY (global_position),
  UNIQUE (stream_id, stream_version)
);
```

| Column | Type | Description |
|---|---|---|
| `global_position` | `BIGSERIAL PK` | Monotonically increasing global ordering across all streams |
| `stream_id` | `TEXT NOT NULL` | Stream identifier (e.g. `"Order-123"`) |
| `stream_version` | `INTEGER NOT NULL` | Sequential version within the stream (1, 2, 3, ...) |
| `id` | `TEXT NOT NULL` | CloudEvents `id` — unique event identifier formatted as `"{streamId}/{streamVersion}"` |
| `source` | `TEXT NOT NULL` | CloudEvents `source` — URI-reference identifying the event source |
| `specversion` | `TEXT NOT NULL` | CloudEvents `specversion` — always `"1.0"` |
| `event_type` | `TEXT NOT NULL` | CloudEvents `type` — event type name (e.g. `"OrderPlaced"`). Named `event_type` because `type` is a SQL reserved word. |
| `subject` | `TEXT NOT NULL` | CloudEvents `subject` — the stream ID |
| `time` | `TIMESTAMPTZ NOT NULL` | CloudEvents `time` — ISO 8601 timestamp of event creation |
| `datacontenttype` | `TEXT NOT NULL` | CloudEvents `datacontenttype` — always `"application/json"` |
| `data` | `JSONB NOT NULL` | Event payload. PII fields are removed if encryption is used. |
| `extensions` | `JSONB NOT NULL` | CloudEvents extension attributes (`correlationid`, `causationid`, `actorid`, `schemaversion`, etc.) |
| `encrypted_data` | `JSONB NULL` | Encrypted PII field blobs. `NULL` for unencrypted events. |
| `crypto_key_id` | `TEXT NULL` | Reference to `crypto_keys.key_id`. `NULL` for unencrypted events. |
| `schema_version` | `INTEGER NOT NULL` | Schema version for upcasting |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Auto-set by the database |

**Design principle:** No column defaults except `created_at` and `global_position` (auto-increment). All values are set explicitly by the application code. A missing value causes a `NOT NULL` violation instead of silently storing a default — this catches bugs early.

**Constraints:**
- `PRIMARY KEY (global_position)` -- global ordering
- `UNIQUE (stream_id, stream_version)` -- enforces sequential versions per stream, serves as OCC safety net

**Indexes:**

```sql
CREATE INDEX IF NOT EXISTS idx_events_stream_id
  ON {schema}.events (stream_id, stream_version);

CREATE INDEX IF NOT EXISTS idx_events_event_type
  ON {schema}.events (event_type);

CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON {schema}.events (created_at);
```

---

### `snapshots`

One snapshot per stream. Used to optimize aggregate loading by caching the computed state at a specific version.

```sql
CREATE TABLE IF NOT EXISTS {schema}.snapshots (
  stream_id        TEXT             NOT NULL,
  stream_version   INTEGER          NOT NULL,
  snapshot_type    TEXT             NOT NULL,
  data             JSONB            NOT NULL,
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),

  PRIMARY KEY (stream_id)
);
```

| Column | Type | Description |
|---|---|---|
| `stream_id` | `TEXT PK` | One snapshot per stream (upserted via `ON CONFLICT`) |
| `stream_version` | `INTEGER NOT NULL` | The stream version at snapshot time |
| `snapshot_type` | `TEXT NOT NULL` | Aggregate type name (e.g. `"Order"`) |
| `data` | `JSONB NOT NULL` | Serialized aggregate state |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Auto-set / updated on upsert |

---

### `outbox`

Transactional outbox for at-least-once delivery of events to external systems.

```sql
CREATE TABLE IF NOT EXISTS {schema}.outbox (
  id               BIGSERIAL        PRIMARY KEY,
  event_global_pos BIGINT           NOT NULL,
  topic            TEXT             NOT NULL,
  payload          JSONB            NOT NULL,
  processed_at     TIMESTAMPTZ      NULL,
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
);
```

| Column | Type | Description |
|---|---|---|
| `id` | `BIGSERIAL PK` | Auto-incrementing outbox entry ID |
| `event_global_pos` | `BIGINT NOT NULL` | Reference to `events.global_position` |
| `topic` | `TEXT NOT NULL` | Message topic/channel name |
| `payload` | `JSONB NOT NULL` | CloudEvents v1.0.2 JSON payload (extension attributes at top level) |
| `processed_at` | `TIMESTAMPTZ NULL` | `NULL` = pending, set = processed |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Auto-set by database |

**Indexes:**

```sql
-- Partial index for efficient polling of unprocessed entries
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON {schema}.outbox (created_at) WHERE processed_at IS NULL;
```

---

### `crypto_keys`

Per-entity encryption keys for GDPR crypto-shredding. Each key is encrypted by the master key (envelope encryption).

```sql
CREATE TABLE IF NOT EXISTS {schema}.crypto_keys (
  key_id           TEXT             PRIMARY KEY,
  encrypted_key    BYTEA            NOT NULL,
  algorithm        TEXT             NOT NULL DEFAULT 'aes-256-gcm',
  revoked_at       TIMESTAMPTZ      NULL,
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
);
```

| Column | Type | Description |
|---|---|---|
| `key_id` | `TEXT PK` | Entity key identifier (e.g. `"user:abc123"`) |
| `encrypted_key` | `BYTEA NOT NULL` | AES key encrypted by master key. Format: `[iv][authTag][ciphertext]` |
| `algorithm` | `TEXT NOT NULL` | Always `"aes-256-gcm"` |
| `revoked_at` | `TIMESTAMPTZ NULL` | `NULL` = active, set = revoked (GDPR erasure) |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Auto-set by database |

**Note:** Revoked keys are **not deleted** -- the `revoked_at` timestamp provides an audit trail for GDPR compliance.

---

### `projections`

Checkpoint tracking for projection runners. Each projection maintains its own cursor.

```sql
CREATE TABLE IF NOT EXISTS {schema}.projections (
  projection_name  TEXT             PRIMARY KEY,
  last_position    BIGINT           NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
);
```

| Column | Type | Description |
|---|---|---|
| `projection_name` | `TEXT PK` | Unique projection identifier |
| `last_position` | `BIGINT NOT NULL` | Last processed `global_position` (checkpoint) |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | Last checkpoint update time |

---

## Migrations

Migrations are run by calling `eventStore.setup()`. This executes `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements, making it safe to call on every application startup.

```typescript
await eventStore.setup(); // Idempotent -- run on every startup
```

The migrations are defined in `packages/event-store/src/schema/migrations.ts`. They do not use Prisma -- the event store manages its own schema independently.
