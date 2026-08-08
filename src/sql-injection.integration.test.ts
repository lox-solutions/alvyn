import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { EventStore } from "./event-store";
import { InvalidSchemaNameError } from "./errors";
import type { OutboxEntry, StoredEvent } from "./types";
import type { SubscribeOptions } from "./subscription/subscribe-options";
import {
  createTestPool,
  startPostgres,
  stopPostgres,
  testSecretValue,
  uniqueSchema,
} from "./__tests__/setup";

let pool: pg.Pool;

const SQL_INJECTION = "' OR 1=1 --";

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  if (pool) await pool.end();
  await stopPostgres();
});

async function collect(
  store: EventStore,
  options: SubscribeOptions & { count: number },
): Promise<StoredEvent[]> {
  const { count, ...subscribeOptions } = options;
  const signalController = new AbortController();
  const events: StoredEvent[] = [];

  for await (const event of store.subscribe({
    pollIntervalMs: 25,
    signal: signalController.signal,
    ...subscribeOptions,
  })) {
    events.push(event);
    if (events.length >= count) {
      signalController.abort();
      break;
    }
  }

  return events;
}

describe("SQL injection resistance", () => {
  it("keeps SQL-looking values parameterized across EventStore APIs", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    const safeStreamId = "safe-1";
    const injectedStreamId = `${SQL_INJECTION}-1`;

    await store.append({
      streamId: safeStreamId,
      expectedVersion: -1,
      events: [{ type: "SafeEvent", data: { marker: "safe" } }],
    });
    await store.append({
      streamId: injectedStreamId,
      expectedVersion: -1,
      outboxTopics: [SQL_INJECTION],
      events: [
        {
          type: SQL_INJECTION,
          source: SQL_INJECTION,
          data: { marker: SQL_INJECTION },
        },
      ],
    });

    expect(await store.getStreamVersion(injectedStreamId)).toBe(1);

    const loaded = await store.load(injectedStreamId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      streamId: injectedStreamId,
      type: SQL_INJECTION,
      source: SQL_INJECTION,
      data: { marker: SQL_INJECTION },
    });

    const resumed = await store.loadFrom(injectedStreamId, {
      fromVersion: 1,
    });
    expect(resumed.map((event) => event.streamId)).toEqual([injectedStreamId]);

    await expect(store.listStreams({ prefix: SQL_INJECTION })).resolves.toEqual(
      [injectedStreamId],
    );

    const exactSubject = await collect(store, {
      count: 1,
      subject: injectedStreamId,
    });
    expect(exactSubject.map((event) => event.subject)).toEqual([
      injectedStreamId,
    ]);

    const recursiveSubject = await collect(store, {
      count: 1,
      subject: SQL_INJECTION,
      recursive: true,
    });
    expect(recursiveSubject.map((event) => event.subject)).toEqual([
      injectedStreamId,
    ]);

    const eventType = await collect(store, {
      count: 1,
      eventTypes: [SQL_INJECTION],
    });
    expect(eventType.map((event) => event.type)).toEqual([SQL_INJECTION]);

    const outboxEntries: OutboxEntry[] = [];
    await expect(
      store.processOutbox((entries) => {
        outboxEntries.push(...entries);
        return Promise.resolve();
      }),
    ).resolves.toBe(1);
    expect(outboxEntries.map((entry) => entry.topic)).toEqual([SQL_INJECTION]);

    const projectionEvents: StoredEvent[] = [];
    await expect(
      store.runProjection({
        projectionName: SQL_INJECTION,
        handle: (event) => {
          projectionEvents.push(event);
          return Promise.resolve();
        },
      }),
    ).resolves.toBe(2);
    expect(projectionEvents.map((event) => event.streamId)).toEqual([
      safeStreamId,
      injectedStreamId,
    ]);

    expect((await store.load(safeStreamId)).map((event) => event.type)).toEqual(
      ["SafeEvent"],
    );

    const relations = await pool.query<{
      events_table: string | null;
      outbox_table: string | null;
      projections_table: string | null;
    }>(
      `SELECT to_regclass($1) AS events_table,
              to_regclass($2) AS outbox_table,
              to_regclass($3) AS projections_table`,
      [`${schema}.events`, `${schema}.outbox`, `${schema}.projections`],
    );
    const relation = relations.rows[0];
    expect(typeof relation?.events_table).toBe("string");
    expect(typeof relation?.outbox_table).toBe("string");
    expect(typeof relation?.projections_table).toBe("string");
  });

  it("keeps SQL-looking crypto key IDs parameterized", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({
      pool,
      schema,
      secrets: {
        currentVersion: 1,
        secrets: [{ version: 1, value: testSecretValue() }],
      },
    });
    await store.setup();

    const safeKeyId = "safe-key";
    const injectedKeyId = SQL_INJECTION;
    const safeStreamId = "User-safe";
    const injectedStreamId = `User-${injectedKeyId}`;

    await store.createCryptoKey(safeKeyId);
    await store.createCryptoKey(injectedKeyId);
    await store.append({
      streamId: safeStreamId,
      expectedVersion: -1,
      events: [
        {
          type: "PrivateData",
          data: { value: "safe" },
          encryptedFields: ["value"],
          cryptoKeyId: safeKeyId,
        },
      ],
    });
    await store.append({
      streamId: injectedStreamId,
      expectedVersion: -1,
      events: [
        {
          type: "PrivateData",
          data: { value: injectedKeyId },
          encryptedFields: ["value"],
          cryptoKeyId: injectedKeyId,
        },
      ],
    });

    await expect(store.load(injectedStreamId)).resolves.toMatchObject([
      { streamId: injectedStreamId, data: { value: injectedKeyId } },
    ]);

    await store.revokeKey(injectedKeyId);
    await expect(store.load(injectedStreamId)).resolves.toMatchObject([
      { streamId: injectedStreamId, data: null, tombstoned: true },
    ]);
    await expect(store.load(safeStreamId)).resolves.toMatchObject([
      { streamId: safeStreamId, data: { value: "safe" } },
    ]);
  });

  it("rejects SQL-looking schema identifiers before query construction", () => {
    expect(
      () => new EventStore({ pool, schema: `${SQL_INJECTION}; DROP SCHEMA x` }),
    ).toThrow(InvalidSchemaNameError);
  });
});
