import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "../event-store";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
} from "../__tests__/setup";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

describe("Snapshots", () => {
  it("save and load round-trip", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.saveSnapshot({
      streamId: "Order-1",
      streamVersion: 5,
      snapshotType: "Order",
      data: { status: "shipped", total: 99.99 },
    });

    const { snapshot } = await store.loadWithSnapshot("Order-1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.streamVersion).toBe(5);
    expect(snapshot!.data).toEqual({ status: "shipped", total: 99.99 });
  });

  it("upserts on same stream_id", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.saveSnapshot({
      streamId: "Order-2",
      streamVersion: 3,
      snapshotType: "Order",
      data: { v: 3 },
    });

    await store.saveSnapshot({
      streamId: "Order-2",
      streamVersion: 5,
      snapshotType: "Order",
      data: { v: 5 },
    });

    const { snapshot } = await store.loadWithSnapshot("Order-2");
    expect(snapshot!.streamVersion).toBe(5);
    expect(snapshot!.data).toEqual({ v: 5 });
  });

  it("delete snapshot", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.saveSnapshot({
      streamId: "Order-3",
      streamVersion: 1,
      snapshotType: "Order",
      data: {},
    });

    await store.deleteSnapshot("Order-3");

    const { snapshot } = await store.loadWithSnapshot("Order-3");
    expect(snapshot).toBeNull();
  });

  it("loadWithSnapshot returns events after snapshot", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    // Append 3 events
    await store.append({
      streamId: "Order-4",
      expectedVersion: -1,
      events: [
        { type: "A", data: { n: 1 } },
        { type: "B", data: { n: 2 } },
        { type: "C", data: { n: 3 } },
      ],
    });

    // Save snapshot at version 2
    await store.saveSnapshot({
      streamId: "Order-4",
      streamVersion: 2,
      snapshotType: "Order",
      data: { state: "at-v2" },
    });

    const { snapshot, events } = await store.loadWithSnapshot("Order-4");
    expect(snapshot!.streamVersion).toBe(2);
    expect(events).toHaveLength(1); // Only event 3 (version 3)
    expect(events[0].type).toBe("C");
  });

  it("loadWithSnapshot with no snapshot returns all events", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.append({
      streamId: "Order-5",
      expectedVersion: -1,
      events: [
        { type: "A", data: {} },
        { type: "B", data: {} },
      ],
    });

    const { snapshot, events } = await store.loadWithSnapshot("Order-5");
    expect(snapshot).toBeNull();
    expect(events).toHaveLength(2);
  });

  it("serializes Map and Set correctly in snapshots", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    const data = {
      users: new Map([
        ["a", 1],
        ["b", 2],
      ]),
      tags: new Set(["x", "y"]),
      plain: "value",
    };

    await store.saveSnapshot({
      streamId: "Complex-1",
      streamVersion: 1,
      snapshotType: "Test",
      data,
    });

    const { snapshot } = await store.loadWithSnapshot("Complex-1");
    const loaded = snapshot!.data as Record<string, unknown>;

    // Map serialized as object { a: 1, b: 2 }
    expect(loaded.users).toEqual({ a: 1, b: 2 });
    // Set serialized as array ["x", "y"]
    expect(loaded.tags).toEqual(["x", "y"]);
    expect(loaded.plain).toBe("value");
  });
});
