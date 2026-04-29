import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "../event-store";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
} from "../__tests__/setup";
import type { OutboxEntry } from "./types";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

describe("Outbox", () => {
  it("creates outbox entries when outboxTopics specified", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.append({
      streamId: "O-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 100 } }],
      outboxTopics: ["orders", "notifications"],
    });

    const received: OutboxEntry[] = [];
    const count = await store.processOutbox(async (entries) => {
      received.push(...entries);
    });

    // 1 event × 2 topics = 2 outbox entries
    expect(count).toBe(2);
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.topic).sort()).toEqual([
      "notifications",
      "orders",
    ]);

    // Verify CloudEvents payload structure
    const payload = received[0]!.payload as Record<string, unknown>;
    expect(payload.specversion).toBe("1.0");
    expect(payload.type).toBe("OrderPlaced");
    expect(payload.data).toEqual({ total: 100 });
  });

  it("no outbox entries without outboxTopics", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.append({
      streamId: "O-2",
      expectedVersion: -1,
      events: [{ type: "A", data: {} }],
    });

    const count = await store.processOutbox(async () => {});
    expect(count).toBe(0);
  });

  it("processOutbox rolls back if handler throws", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    await store.append({
      streamId: "O-3",
      expectedVersion: -1,
      events: [{ type: "A", data: {} }],
      outboxTopics: ["t"],
    });

    await expect(
      store.processOutbox(async () => {
        throw new Error("Handler failed");
      }),
    ).rejects.toThrow("Handler failed");

    // Entries should still be pending (not marked processed)
    const count = await store.processOutbox(async () => {});
    expect(count).toBe(1);
  });

  it("processOutbox respects limit", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.append({
      streamId: "O-4",
      expectedVersion: -1,
      events: [
        { type: "A", data: {} },
        { type: "B", data: {} },
        { type: "C", data: {} },
      ],
      outboxTopics: ["t"],
    });

    const count = await store.processOutbox(async () => {}, 2);
    expect(count).toBe(2);

    // Remaining 1
    const count2 = await store.processOutbox(async () => {});
    expect(count2).toBe(1);
  });

  it("cleanupOutbox deletes old processed entries", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    await store.append({
      streamId: "O-5",
      expectedVersion: -1,
      events: [{ type: "A", data: {} }],
      outboxTopics: ["t"],
    });

    // Process all entries
    await store.processOutbox(async () => {});

    // Backdate processed_at to make it "old"
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE ${schema}.outbox SET processed_at = now() - interval '30 days'`,
      );
    } finally {
      client.release();
    }

    const deleted = await store.cleanupOutbox(7 * 24 * 60 * 60 * 1000, 100);
    expect(deleted).toBe(1);
  });

  it("cleanupOutbox returns 0 when nothing to delete", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();
    const deleted = await store.cleanupOutbox();
    expect(deleted).toBe(0);
  });
});
