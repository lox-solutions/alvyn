import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "./event-store";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
} from "./__tests__/setup";
import { IdempotencyConflictError } from "./errors";

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

    const input = {
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

    // Second call with same idempotencyKey
    const secondResult = await store.append(input);
    expect(secondResult).toEqual(firstResult);

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

    // All results must be identical
    for (const res of results) {
      expect(res).toEqual(results[0]);
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
  });
});
