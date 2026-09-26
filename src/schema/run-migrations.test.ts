import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import {
  createTestPool,
  startPostgres,
  stopPostgres,
  uniqueSchema,
} from "../__tests__/setup";
import { EventStore } from "../event-store";
import { migrateEventStore } from "./migrate-event-store";
import { verifyMigrations } from "./run-migrations";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

describe("versioned event store migrations", () => {
  it("allows a deployment job to migrate and an app with no DDL privileges to verify", async () => {
    const schema = uniqueSchema();
    const app = new EventStore({ pool, schema, migrationMode: "verify" });
    await expect(app.setup()).rejects.toThrow(/run migrateEventStore/);
    expect(app.isInitialized()).toBe(false);

    await migrateEventStore({ pool, schema });
    const role = uniqueSchema();
    await pool.query(`CREATE ROLE ${role}`);
    await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await pool.query(`GRANT SELECT ON ${schema}.schema_version TO ${role}`);
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      await expect(verifyMigrations(client, schema)).resolves.toBeUndefined();
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
    await expect(app.setup()).resolves.toBeUndefined();
    expect(app.isInitialized()).toBe(true);
    const version = await pool.query<{ version: number }>(
      `SELECT version FROM ${schema}.schema_version`,
    );
    expect(version.rows).toEqual([{ version: 1 }]);
  });

  it("serializes simultaneous first-time migrations and skips DDL on rerun", async () => {
    const schema = uniqueSchema();
    await Promise.all(
      Array.from({ length: 4 }, () => migrateEventStore({ pool, schema })),
    );
    const before = await pool.query<{ oid: number }>(
      "SELECT oid FROM pg_trigger WHERE tgrelid = to_regclass($1) AND tgname = 'lock_event_positions'",
      [`${schema}.events`],
    );
    expect(before.rows).toHaveLength(1);
    await migrateEventStore({ pool, schema });
    const after = await pool.query<{ oid: number }>(
      "SELECT oid FROM pg_trigger WHERE tgrelid = to_regclass($1) AND tgname = 'lock_event_positions'",
      [`${schema}.events`],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("rolls back a failed migration, releases the lock, and permits retry", async () => {
    const schema = uniqueSchema();
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.unrelated (id INTEGER)`);
    await pool.query(
      `CREATE INDEX idx_events_event_type ON ${schema}.unrelated (id)`,
    );
    await expect(migrateEventStore({ pool, schema })).rejects.toThrow(
      /idx_events_event_type/,
    );
    const metadata = await pool.query<{ relation: string | null }>(
      "SELECT to_regclass($1)::text AS relation",
      [`${schema}.schema_version`],
    );
    expect(metadata.rows[0]?.relation).toBeNull();
    const events = await pool.query<{ relation: string | null }>(
      "SELECT to_regclass($1)::text AS relation",
      [`${schema}.events`],
    );
    expect(events.rows[0]?.relation).toBeNull();
    await pool.query(`DROP INDEX ${schema}.idx_events_event_type`);
    await expect(migrateEventStore({ pool, schema })).resolves.toBeUndefined();
  });

  it("rejects unversioned event-store objects without altering existing data", async () => {
    const schema = uniqueSchema();
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.events (marker INTEGER)`);
    await pool.query(`INSERT INTO ${schema}.events VALUES (42)`);
    await expect(migrateEventStore({ pool, schema })).rejects.toThrow(
      /unversioned event-store objects/,
    );
    const stored = await pool.query<{ marker: number }>(
      `SELECT marker FROM ${schema}.events`,
    );
    expect(stored.rows).toEqual([{ marker: 42 }]);
  });

  it("fails verification if the trigger is disabled or the schema version is unknown", async () => {
    const schema = uniqueSchema();
    await migrateEventStore({ pool, schema });
    await pool.query(
      `ALTER TABLE ${schema}.events DISABLE TRIGGER lock_event_positions`,
    );
    await expect(
      new EventStore({ pool, schema, migrationMode: "verify" }).setup(),
    ).rejects.toThrow(/no active event-position fence/);
    await pool.query(
      `ALTER TABLE ${schema}.events ENABLE TRIGGER lock_event_positions`,
    );
    await pool.query(`DROP SEQUENCE ${schema}.projection_safe_watermark`);
    await expect(
      new EventStore({ pool, schema, migrationMode: "verify" }).setup(),
    ).rejects.toThrow(/safe-watermark sequence/);
    await pool.query(
      `CREATE SEQUENCE ${schema}.projection_safe_watermark AS BIGINT MINVALUE 0 START WITH 0`,
    );
    await pool.query(`UPDATE ${schema}.schema_version SET version = 99`);
    await expect(
      new EventStore({ pool, schema, migrationMode: "verify" }).setup(),
    ).rejects.toThrow(/expected 1/);
    await expect(migrateEventStore({ pool, schema })).rejects.toThrow(
      /Unsupported Alvyn schema version 99/,
    );
  });
});
