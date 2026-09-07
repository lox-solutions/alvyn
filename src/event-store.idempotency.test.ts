import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "./event-store";
import type { AppendInput } from "./types";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
} from "./__tests__/setup";
import { IdempotencyConflictError } from "./errors";
import { defineSnapshot } from "./snapshot/define-snapshot";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

function makeStore(schema?: string) {
  return new EventStore({
    pool,
    schema: schema ?? uniqueSchema(),
  });
}

describe("EventStore idempotency", () => {
  it("returns identical AppendResult and does not duplicate events on retry", async () => {
    const store = makeStore();
    await store.setup();

    const input: AppendInput<{ total?: number; amount?: number }> = {
      streamId: "Order-100",
      expectedVersion: -1,
      events: [
        { type: "OrderPlaced", data: { total: 42 } },
        { type: "OrderPaid", data: { amount: 42 } },
      ],
      idempotencyKey: "order-100-create",
    };

    const firstResult = await store.append(input);
    expect(firstResult.streamId).toBe("Order-100");
    expect(firstResult.fromVersion).toBe(1);
    expect(firstResult.toVersion).toBe(2);
    expect(firstResult.globalPositions).toHaveLength(2);
    expect(firstResult.isDuplicate).toBe(false);

    // Second call with same idempotencyKey
    const secondResult = await store.append(input);
    expect(secondResult).toEqual({
      ...firstResult,
      isDuplicate: true,
    });

    // Verify only 2 events exist in store
    const loaded = await store.load("Order-100");
    expect(loaded).toHaveLength(2);
    expect(loaded.map((e) => e.type)).toEqual(["OrderPlaced", "OrderPaid"]);
    expect(await store.getStreamVersion("Order-100")).toBe(2);
  });

  it("does not insert duplicate outbox entries on retry", async () => {
    const store = makeStore();
    await store.setup();

    const input = {
      streamId: "Order-200",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 99 } }],
      outboxTopics: ["orders.events"],
      idempotencyKey: "order-200-outbox",
    };

    await store.append(input);
    await store.append(input); // retry

    let processedCount = 0;
    await store.processOutbox(() => {
      processedCount++;
      return Promise.resolve();
    });

    expect(processedCount).toBe(1);
  });

  it("throws IdempotencyConflictError when same key is reused for a different stream", async () => {
    const store = makeStore();
    await store.setup();

    await store.append({
      streamId: "Stream-A",
      expectedVersion: -1,
      events: [{ type: "Created", data: { name: "A" } }],
      idempotencyKey: "shared-idem-key",
    });

    await expect(
      store.append({
        streamId: "Stream-B",
        expectedVersion: -1,
        events: [{ type: "Created", data: { name: "B" } }],
        idempotencyKey: "shared-idem-key",
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("throws IdempotencyConflictError when same key is reused with different event payload", async () => {
    const store = makeStore();
    await store.setup();

    await store.append({
      streamId: "Order-Payload-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 100 } }],
      idempotencyKey: "payload-idem-key",
    });

    await expect(
      store.append({
        streamId: "Order-Payload-1",
        expectedVersion: -1,
        events: [{ type: "OrderCancelled", data: {} }],
        idempotencyKey: "payload-idem-key",
      }),
    ).rejects.toThrow(
      /Idempotency key was already used with a different event payload/,
    );
  });

  it("treats identical payload with different JSON property order as duplicate", async () => {
    const store = makeStore();
    await store.setup();

    const firstResult = await store.append({
      streamId: "Order-Payload-Order",
      expectedVersion: -1,
      events: [
        {
          type: "OrderPlaced",
          data: { b: 2, a: 1, nested: { y: 20, x: 10 } },
        },
      ],
      idempotencyKey: "order-canonical-key",
    });
    expect(firstResult.isDuplicate).toBe(false);

    // Same data but different property insertion order
    const secondResult = await store.append({
      streamId: "Order-Payload-Order",
      expectedVersion: -1,
      events: [
        {
          type: "OrderPlaced",
          data: { a: 1, b: 2, nested: { x: 10, y: 20 } },
        },
      ],
      idempotencyKey: "order-canonical-key",
    });
    expect(secondResult.isDuplicate).toBe(true);
    expect(secondResult.globalPositions).toEqual(firstResult.globalPositions);
  });

  it("throws IdempotencyConflictError when same key is reused with different outboxTopics", async () => {
    const store = makeStore();
    await store.setup();

    await store.append({
      streamId: "Order-Outbox-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 100 } }],
      outboxTopics: ["topic-1"],
      idempotencyKey: "outbox-conflict-key",
    });

    await expect(
      store.append({
        streamId: "Order-Outbox-1",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 100 } }],
        outboxTopics: ["topic-2"],
        idempotencyKey: "outbox-conflict-key",
      }),
    ).rejects.toThrow(
      /Idempotency key was already used with a different event payload/,
    );
  });

  it("throws IdempotencyConflictError when same key is reused with outboxTopics vs without", async () => {
    const store = makeStore();
    await store.setup();

    await store.append({
      streamId: "Order-Outbox-2",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 100 } }],
      idempotencyKey: "outbox-presence-key",
    });

    await expect(
      store.append({
        streamId: "Order-Outbox-2",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 100 } }],
        outboxTopics: ["topic-1"],
        idempotencyKey: "outbox-presence-key",
      }),
    ).rejects.toThrow(
      /Idempotency key was already used with a different event payload/,
    );
  });

  it("skips snapshot update on deduplicated retry", async () => {
    const Snapshot = defineSnapshot<
      { balance: number },
      { Deposit: { amount: number } }
    >()({
      streamPrefix: "Account",
      snapshotName: "AccountBalance",
      every: 2,
      initialState: { balance: 0 },
      evolve: {
        Deposit: (state, event) => ({
          balance: state.balance + (event.data?.amount ?? 0),
        }),
      },
    });

    const store = new EventStore({
      pool,
      schema: uniqueSchema(),
      snapshots: [Snapshot],
    });
    await store.setup();

    // 1st append triggers snapshot after 2 events
    const firstResult = await store.append({
      streamId: "Account-1",
      expectedVersion: -1,
      events: [
        { type: "Deposit", data: { amount: 50 } },
        { type: "Deposit", data: { amount: 50 } },
      ],
      idempotencyKey: "snap-idem-key",
    });

    expect(firstResult.isDuplicate).toBe(false);

    const eventsAfterFirst = await store.load("Account-1");
    // Events should be Deposit, Deposit, AccountBalanceSnapshot
    expect(eventsAfterFirst).toHaveLength(3);
    expect(eventsAfterFirst[2].type).toBe("AccountBalanceSnapshot");

    // 2nd append with same idempotency key (retry)
    const secondResult = await store.append({
      streamId: "Account-1",
      expectedVersion: -1,
      events: [
        { type: "Deposit", data: { amount: 50 } },
        { type: "Deposit", data: { amount: 50 } },
      ],
      idempotencyKey: "snap-idem-key",
    });

    expect(secondResult.isDuplicate).toBe(true);

    // Should still have exactly 3 events (no duplicate snapshot appended)
    const eventsAfterSecond = await store.load("Account-1");
    expect(eventsAfterSecond).toHaveLength(3);
  });

  it("handles concurrent appends with the same idempotency key safely", async () => {
    const store = makeStore();
    await store.setup();

    const input = {
      streamId: "Concurrent-1",
      expectedVersion: -1,
      events: [{ type: "Created", data: { val: 1 } }],
      idempotencyKey: "concurrent-idem-key",
    };

    // Fire 5 concurrent appends simultaneously
    const results = await Promise.all([
      store.append(input),
      store.append(input),
      store.append(input),
      store.append(input),
      store.append(input),
    ]);

    // All results must match streamId, fromVersion, toVersion, and globalPositions
    for (const res of results) {
      expect(res.streamId).toBe(results[0].streamId);
      expect(res.fromVersion).toBe(results[0].fromVersion);
      expect(res.toVersion).toBe(results[0].toVersion);
      expect(res.globalPositions).toEqual(results[0].globalPositions);
    }

    const events = await store.load("Concurrent-1");
    expect(events).toHaveLength(1);
  });

  it("allows subsequent appends with different idempotency keys on the same stream", async () => {
    const store = makeStore();
    await store.setup();

    const res1 = await store.append({
      streamId: "Order-300",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 10 } }],
      idempotencyKey: "key-1",
    });
    expect(res1.toVersion).toBe(1);

    const res2 = await store.append({
      streamId: "Order-300",
      expectedVersion: 1,
      events: [{ type: "OrderPaid", data: { total: 10 } }],
      idempotencyKey: "key-2",
    });
    expect(res2.toVersion).toBe(2);

    expect(await store.getStreamVersion("Order-300")).toBe(2);
  });

  it("rolls back idempotency key if explicit transaction fails", async () => {
    const store = makeStore();
    await store.setup();

    await expect(
      store.withTransaction(async (client) => {
        await store.append(
          {
            streamId: "Tx-Stream-1",
            expectedVersion: -1,
            events: [{ type: "Created", data: {} }],
            idempotencyKey: "tx-fail-key",
          },
          { client },
        );
        throw new Error("Forced transaction failure");
      }),
    ).rejects.toThrow("Forced transaction failure");

    // The key should not be recorded; next append with same key should succeed as fresh append
    const res = await store.append({
      streamId: "Tx-Stream-1",
      expectedVersion: -1,
      events: [{ type: "Created", data: {} }],
      idempotencyKey: "tx-fail-key",
    });
    expect(res.fromVersion).toBe(1);
    expect(res.toVersion).toBe(1);
    expect(res.isDuplicate).toBe(false);
  });

  it("cleanupIdempotencyKeys deletes old entries and returns deleted count", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    await store.append({
      streamId: "Order-Old",
      expectedVersion: -1,
      events: [{ type: "Created", data: {} }],
      idempotencyKey: "old-key",
    });

    await store.append({
      streamId: "Order-New",
      expectedVersion: -1,
      events: [{ type: "Created", data: {} }],
      idempotencyKey: "new-key",
    });

    // Artificially age the first key
    await pool.query(
      `UPDATE ${schema}.idempotency_keys
       SET created_at = now() - interval '8 days'
       WHERE key = 'old-key'`,
    );

    const deleted = await store.cleanupIdempotencyKeys(
      7 * 24 * 60 * 60 * 1000,
      100,
    );
    expect(deleted).toBe(1);

    // Verify old key was deleted and new key remains
    const remaining = await pool.query<{ key: string }>(
      `SELECT key FROM ${schema}.idempotency_keys ORDER BY key`,
    );
    expect(remaining.rows.map((r) => r.key)).toEqual(["new-key"]);
  });

  it("cleanupIdempotencyKeys returns 0 when nothing to delete", async () => {
    const store = makeStore();
    await store.setup();
    const deleted = await store.cleanupIdempotencyKeys();
    expect(deleted).toBe(0);
  });
});
