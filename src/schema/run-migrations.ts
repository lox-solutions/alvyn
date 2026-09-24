import type { PoolClient } from "pg";

import {
  MIGRATION_LOCK_KEY,
  WATERMARK_LOCK_KEY,
} from "../event-store-constants";

async function createEventsTable(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`
    CREATE TABLE ${schema}.events (
      global_position  BIGSERIAL        NOT NULL,
      stream_id        TEXT             NOT NULL,
      stream_version   INTEGER          NOT NULL,

      -- CloudEvents v1.0.2 REQUIRED context attributes
      id               TEXT             NOT NULL,
      source           TEXT             NOT NULL,
      specversion      TEXT             NOT NULL,
      event_type       TEXT             NOT NULL,

      -- CloudEvents v1.0.2 OPTIONAL context attributes
      subject          TEXT             NOT NULL,
      time             TIMESTAMPTZ      NOT NULL,
      datacontenttype  TEXT             NOT NULL,

      -- CloudEvents event data
      data             JSONB            NOT NULL,

      -- CloudEvents extension attributes
      extensions       JSONB            NOT NULL,

      -- Crypto-shredding (GDPR)
      encrypted_data   JSONB            NULL,
      crypto_key_id    TEXT             NULL,

      -- Internal: schema version for upcasting
      schema_version   INTEGER          NOT NULL,

      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
      txid             XID8             NOT NULL DEFAULT pg_current_xact_id(),

      PRIMARY KEY (global_position),
      UNIQUE (stream_id, stream_version)
    )
  `);

  await createEventIndexes(client, schema);
  await createEventPositionFence(client, schema);
}

async function createEventIndexes(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`
    CREATE INDEX idx_events_stream_id
      ON ${schema}.events (stream_id, stream_version)
  `);

  await client.query(`
    CREATE INDEX idx_events_stream_global_position
      ON ${schema}.events (stream_id, global_position, id)
  `);

  await client.query(`
    CREATE INDEX idx_events_event_type
      ON ${schema}.events (event_type)
  `);

  await client.query(`
    CREATE INDEX idx_events_created_at
      ON ${schema}.events (created_at)
  `);

  await client.query(`
    CREATE INDEX idx_events_source_id
      ON ${schema}.events (source, id)
  `);
}

/** The statement trigger runs before BIGSERIAL defaults reserve any positions. */
async function createEventPositionFence(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`
    CREATE FUNCTION ${schema}.lock_event_positions()
      RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock_shared(hashtext(TG_TABLE_SCHEMA), ${WATERMARK_LOCK_KEY});
      RETURN NULL;
    END;
    $$
  `);
  await client.query(`
    CREATE TRIGGER lock_event_positions
      BEFORE INSERT ON ${schema}.events
      FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.lock_event_positions()
  `);
}

async function createIdempotencyKeysTable(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`
    CREATE TABLE ${schema}.idempotency_keys (
      key              TEXT             PRIMARY KEY,
      stream_id        TEXT             NOT NULL,
      request_hash     TEXT             NOT NULL,
      from_version     INTEGER          NOT NULL,
      to_version       INTEGER          NOT NULL,
      global_positions BIGINT[]         NOT NULL,
      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE INDEX idx_idempotency_keys_created_at
      ON ${schema}.idempotency_keys (created_at)
  `);
}

async function createSupportTables(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query(`
    CREATE TABLE ${schema}.outbox (
      id               BIGSERIAL        PRIMARY KEY,
      event_global_pos BIGINT           NOT NULL,
      topic            TEXT             NOT NULL,
      payload          JSONB            NOT NULL,
      processed_at     TIMESTAMPTZ      NULL,
      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE INDEX idx_outbox_pending
      ON ${schema}.outbox (created_at) WHERE processed_at IS NULL
  `);

  await client.query(`
    CREATE TABLE ${schema}.crypto_keys (
      key_id           TEXT             PRIMARY KEY,
      encrypted_key    BYTEA            NULL,
      algorithm        TEXT             NOT NULL DEFAULT 'aes-256-gcm',
      revoked_at       TIMESTAMPTZ      NULL,
      created_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE ${schema}.projections (
      projection_name  TEXT             PRIMARY KEY,
      last_position    BIGINT           NOT NULL DEFAULT 0,
      updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now()
    )
  `);

  // Sequence state is non-transactional: a certified position must remain
  // available to readers even if their projection transaction later rolls back.
  await client.query(`
    CREATE SEQUENCE ${schema}.projection_safe_watermark
      AS BIGINT MINVALUE 0 START WITH 0
  `);

  await createIdempotencyKeysTable(client, schema);
}

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Fails closed if setup skipped a migration or the event-position fence is disabled.
 * This performs no DDL and can run using an application role without CREATE rights.
 */
export async function verifyMigrations(
  client: PoolClient,
  schema: string,
): Promise<void> {
  const relation = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${schema}.schema_version`],
  );
  if (!relation.rows[0]?.exists) {
    throw new Error(
      `Alvyn schema "${schema}" is not migrated; run migrateEventStore() first.`,
    );
  }
  const version = await client.query<{ version: number }>(
    `SELECT version FROM ${schema}.schema_version WHERE id = 1`,
  );
  if (version.rows[0]?.version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Alvyn schema "${schema}" has version ${version.rows[0]?.version ?? "none"}; expected ${CURRENT_SCHEMA_VERSION}. Run migrateEventStore() with a DDL-capable connection.`,
    );
  }

  const fence = await client.query<{
    valid: boolean;
    watermark_valid: boolean;
  }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_trigger AS t
       JOIN pg_class AS c ON c.oid = t.tgrelid
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = 'events'
         AND t.tgname = 'lock_event_positions' AND NOT t.tgisinternal
         AND t.tgenabled IN ('O', 'A')
         AND t.tgfoid = to_regprocedure($2)
         AND (t.tgtype & 7) = 6
     ) AS valid,
     EXISTS (
       SELECT 1 FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = 'projection_safe_watermark'
         AND c.relkind = 'S'
     ) AS watermark_valid`,
    [schema, `${schema}.lock_event_positions()`],
  );
  if (!fence.rows[0]?.valid || !fence.rows[0].watermark_valid) {
    throw new Error(
      `Alvyn schema "${schema}" has no active event-position fence or safe-watermark sequence; migration verification failed.`,
    );
  }
}

async function initializeVersionTable(
  client: PoolClient,
  schema: string,
): Promise<void> {
  const metadata = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${schema}.schema_version`],
  );
  if (metadata.rows[0]?.exists) return;

  const existing = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname IN
         ('events', 'outbox', 'projections', 'crypto_keys',
          'idempotency_keys', 'projection_safe_watermark')
     ) AS present`,
    [schema],
  );
  if (existing.rows[0]?.present) {
    throw new Error(
      `Alvyn schema "${schema}" contains unversioned event-store objects. ` +
        "Use a fresh schema or plan an explicit data migration; no existing data was changed.",
    );
  }
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(`
    CREATE TABLE ${schema}.schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    )
  `);
}

async function applyPendingMigrations(
  client: PoolClient,
  schema: string,
): Promise<void> {
  const result = await client.query<{ version: number }>(
    `SELECT version FROM ${schema}.schema_version WHERE id = 1`,
  );
  const version = result.rows[0]?.version ?? 0;
  if (version > CURRENT_SCHEMA_VERSION || version < 0) {
    throw new Error(
      `Unsupported Alvyn schema version ${version} in "${schema}".`,
    );
  }
  if (version < 1) {
    await createEventsTable(client, schema);
    await createSupportTables(client, schema);
    await client.query(
      `INSERT INTO ${schema}.schema_version (id, version) VALUES (1, $1)`,
      [CURRENT_SCHEMA_VERSION],
    );
  }
}

/**
 * Applies versioned schema changes in one transaction. A transaction-scoped
 * advisory lock serializes concurrent replicas without requiring a pinned
 * backend session when used behind a transaction-pooling proxy.
 */
export async function runMigrations(
  client: PoolClient,
  schema: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), $2)`, [
      schema,
      MIGRATION_LOCK_KEY,
    ]);
    await initializeVersionTable(client, schema);
    await applyPendingMigrations(client, schema);
    await verifyMigrations(client, schema);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
