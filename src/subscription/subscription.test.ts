import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "../event-store";
import type { StoredEvent } from "../types";
import type { SubscribeOptions } from "./subscribe-options";
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

async function newStore(): Promise<EventStore> {
  const store = new EventStore({ pool, schema: uniqueSchema() });
  await store.setup();
  return store;
}

/** Collects up to `count` events from a subscription, then stops the stream. */
async function collect(
  store: EventStore,
  opts: SubscribeOptions & { count: number },
): Promise<StoredEvent[]> {
  const { count, ...subscribeOptions } = opts;
  const ac = new AbortController();
  const out: StoredEvent[] = [];
  for await (const event of store.subscribe({
    pollIntervalMs: 25,
    signal: ac.signal,
    ...subscribeOptions,
  })) {
    out.push(event);
    if (out.length >= count) {
      ac.abort();
      break;
    }
  }
  return out;
}

describe("subscribe", () => {
  it("streams historical events in global order (catch-up)", async () => {
    const store = await newStore();
    await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [
        { type: "OrderPlaced", data: { total: 1 } },
        { type: "OrderShipped", data: { tracking: "T1" } },
      ],
    });
    await store.append({
      streamId: "Order-2",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 2 } }],
    });

    const events = await collect(store, { count: 3 });
    expect(events.map((e) => e.type)).toEqual([
      "OrderPlaced",
      "OrderShipped",
      "OrderPlaced",
    ]);
    const positions = events.map((e) => e.globalPosition);
    expect(positions[0] < positions[1] && positions[1] < positions[2]).toBe(
      true,
    );
  });

  it("transitions from catch-up to live events on the same iterator", async () => {
    const store = await newStore();
    await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 1 } }],
    });

    const ac = new AbortController();
    const received: StoredEvent[] = [];
    const done = (async () => {
      for await (const event of store.subscribe({
        pollIntervalMs: 25,
        signal: ac.signal,
      })) {
        received.push(event);
        if (received.length >= 2) {
          ac.abort();
          break;
        }
      }
    })();

    // Append a live event after the subscription has started catching up.
    await new Promise((r) => setTimeout(r, 50));
    await store.append({
      streamId: "Order-1",
      expectedVersion: 1,
      events: [{ type: "OrderShipped", data: { tracking: "T1" } }],
    });

    await done;
    expect(received.map((e) => e.type)).toEqual([
      "OrderPlaced",
      "OrderShipped",
    ]);
  });

  it("fans out: two independent subscribers each receive every event", async () => {
    const store = await newStore();
    await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [
        { type: "OrderPlaced", data: { total: 1 } },
        { type: "OrderShipped", data: { tracking: "T1" } },
      ],
    });

    const [a, b] = await Promise.all([
      collect(store, { count: 2 }),
      collect(store, { count: 2 }),
    ]);
    expect(a.map((e) => e.type)).toEqual(["OrderPlaced", "OrderShipped"]);
    expect(b.map((e) => e.type)).toEqual(["OrderPlaced", "OrderShipped"]);
  });

  it("resumes from a lowerBound cursor (exclusive)", async () => {
    const store = await newStore();
    const r1 = await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 1 } }],
    });
    await store.append({
      streamId: "Order-1",
      expectedVersion: 1,
      events: [{ type: "OrderShipped", data: { tracking: "T1" } }],
    });

    const resumed = await collect(store, {
      count: 1,
      lowerBound: { id: r1.globalPositions[0].toString(), type: "exclusive" },
    });
    expect(resumed.map((e) => e.type)).toEqual(["OrderShipped"]);
  });

  it("resumes from a lowerBound cursor (inclusive)", async () => {
    const store = await newStore();
    const r1 = await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 1 } }],
    });
    await store.append({
      streamId: "Order-1",
      expectedVersion: 1,
      events: [{ type: "OrderShipped", data: { tracking: "T1" } }],
    });

    const resumed = await collect(store, {
      count: 2,
      lowerBound: { id: r1.globalPositions[0].toString(), type: "inclusive" },
    });
    expect(resumed.map((e) => e.type)).toEqual(["OrderPlaced", "OrderShipped"]);
  });

  it("filters by subject (exact) and event type", async () => {
    const store = await newStore();
    await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: {} }],
    });
    await store.append({
      streamId: "User-1",
      expectedVersion: -1,
      events: [{ type: "UserCreated", data: {} }],
    });

    const onlyOrders = await collect(store, { count: 1, subject: "Order-1" });
    expect(onlyOrders.map((e) => e.subject)).toEqual(["Order-1"]);

    const onlyType = await collect(store, {
      count: 1,
      eventTypes: ["UserCreated"],
    });
    expect(onlyType.map((e) => e.type)).toEqual(["UserCreated"]);
  });

  it("filters recursively by subject prefix", async () => {
    const store = await newStore();
    await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: {} }],
    });
    await store.append({
      streamId: "Order-2",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: {} }],
    });
    await store.append({
      streamId: "User-1",
      expectedVersion: -1,
      events: [{ type: "UserCreated", data: {} }],
    });

    const orders = await collect(store, {
      count: 2,
      subject: "Order-",
      recursive: true,
    });
    expect(
      orders
        .map((e) => e.subject)
        .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["Order-1", "Order-2"]);
  });

  it("delivers live events via NOTIFY well before the poll interval elapses", async () => {
    const store = await newStore();

    const ac = new AbortController();
    const received: StoredEvent[] = [];
    let firstAt = 0;
    const startedAt = Date.now();
    // A deliberately long poll interval: if the event arrives quickly it must
    // be via NOTIFY, not the polling fallback.
    const done = (async () => {
      for await (const event of store.subscribe({
        pollIntervalMs: 10_000,
        signal: ac.signal,
      })) {
        received.push(event);
        firstAt = Date.now();
        ac.abort();
        break;
      }
    })();

    // Give the subscriber time to enter the LISTEN wait, then append.
    await new Promise((r) => setTimeout(r, 100));
    await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: {} }],
    });

    await done;
    expect(received).toHaveLength(1);
    expect(firstAt - startedAt).toBeLessThan(2_000);
  });

  it("stops the iterator when the abort signal fires", async () => {
    const store = await newStore();
    await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: {} }],
    });

    const ac = new AbortController();
    const received: StoredEvent[] = [];
    const done = (async () => {
      for await (const event of store.subscribe({
        pollIntervalMs: 25,
        signal: ac.signal,
      })) {
        received.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    await done;
    expect(received.length).toBe(1);
  });
});
