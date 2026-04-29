import type { PoolClient } from "pg";

/**
 * Runs all idempotent schema migrations for the event store.
 * Safe to call on every application startup — uses IF NOT EXISTS throughout.
 *
 * All tables live in a dedicated PostgreSQL schema (default: "event_store")
 * to avoid collisions with application tables managed by Prisma or other ORMs.
 *
 * The events table stores CloudEvents v1.0.2 context attributes as dedicated
 * columns: `id`, `source`, `specversion`, `type` (event_type), `subject`,
 * `time`, `datacontenttype`. Extension attributes are stored in the
 * `extensions` JSONB column.
 */
export async function runMigrations(client: PoolClient, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

  // Events table — CloudEvents v1.0.2 compliant
  //
  // REQUIRED context attributes: id, source, specversion, type (event_type)
  // OPTIONAL context attributes: subject, time, datacontenttype
  // Extension attributes: stored in `extensions` JSONB column
  // Event data: stored in `data` JSONB column
  // Crypto fields: encrypted_data, crypto_key_id
  // Internal: global_position, stream_id, stream_version, schema_version, created_at
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.events (
      global_position  BIGSERIAL        NOT NULL,
      stream_id        TEXT             NOT NULL,
      stream_version   INTEGER          NOT NULL,

      -- CloudEvents v1.0.2 REQUIRED context attributes
      -- No defaults: the application MUST provide all values explicitly.
      -- A missing value causes a NOT NULL violation instead of silently storing a default.
      id               TEXT             NOT NULL,
      source           TEXT             NOT NULL,
      specversion      TEXT             NOT NULL,
      event_type       TEXT             NOT NULL,

      -- CloudEvents v1.0.2 OPTIONAL context attributes
      -- In this library these are always set by the writer, so NOT NULL is safe.
      subject          TEXT             NOT NULL,
      time             TIMESTAMPTZ      NOT NULL,
      datacontenttype  TEXT             NOT NULL,

      -- CloudEvents event data
      data             JSONB            NOT NULL,

      -- CloudEvents extension attributes (correlationid, causationid, actorid, schemaversion, etc.)
      extensions       JSONB            NOT NULL,

      -- Crypto-shredding (GDPR)
      encrypted_data   JSONB            NULL,
      crypto_key_id    TEXT             NULL,

      -- Internal: schema version for upcasting (denormalized from extensions for index efficiency)
      schema_version   INTEGER          NOT NULL,

      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),

      PRIMARY KEY (global_position),
      UNIQUE (stream_id, stream_version)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_events_stream_id
      ON ${schema}.events (stream_id, stream_version)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_events_event_type
      ON ${schema}.events (event_type)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_events_created_at
      ON ${schema}.events (created_at)
  `);

  // CloudEvents id index for deduplication lookups
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_events_source_id
      ON ${schema}.events (source, id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.snapshots (
      stream_id        TEXT             NOT NULL,
      stream_version   INTEGER          NOT NULL,
      snapshot_type    TEXT             NOT NULL,
      data             JSONB            NOT NULL,
      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),

      PRIMARY KEY (stream_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.outbox (
      id               BIGSERIAL        PRIMARY KEY,
      event_global_pos BIGINT           NOT NULL,
      topic            TEXT             NOT NULL,
      payload          JSONB            NOT NULL,
      processed_at     TIMESTAMPTZ      NULL,
      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_outbox_pending
      ON ${schema}.outbox (created_at) WHERE processed_at IS NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.crypto_keys (
      key_id           TEXT             PRIMARY KEY,
      encrypted_key    BYTEA            NOT NULL,
      algorithm        TEXT             NOT NULL DEFAULT 'aes-256-gcm',
      revoked_at       TIMESTAMPTZ      NULL,
      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.projections (
      projection_name  TEXT             PRIMARY KEY,
      last_position    BIGINT           NOT NULL DEFAULT 0,
      updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
  `);
}
