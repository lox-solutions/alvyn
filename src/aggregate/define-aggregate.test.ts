import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import type { AggregateReplayedEvent, AggregateStoredEvent } from "./types";
import { EventStore } from "../event-store";
import { ReservedSnapshotEventTypeError } from "../errors";
import { defineAggregate } from "./define-aggregate";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
  testMasterKey,
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

type OrderEvents = {
  OrderPlaced: { total: number };
  OrderShipped: { tracking: string };
  OrderCancelled: Record<string, never>;
};

type OrderState = {
  status: string;
  total: number;
};

type OrderStoredEvent = AggregateStoredEvent<OrderEvents>;

function isOrderPlacedEvent(
  event: AggregateReplayedEvent<OrderEvents>,
): event is Extract<OrderStoredEvent, { type: "OrderPlaced" }> {
  return !("tombstoned" in event) && event.type === "OrderPlaced";
}

const Order = defineAggregate<OrderState, OrderEvents>()({
  streamPrefix: "Order",
  evolve: {
    OrderPlaced: (state, event) => ({
      ...state,
      status: "placed",
      total: event.data?.total ?? 0,
    }),
    OrderShipped: (state) => ({ ...state, status: "shipped" }),
    OrderCancelled: (state) => ({ ...state, status: "cancelled" }),
  },
});

describe("defineAggregate", () => {
  it("streamPrefix exposed", () => {
    expect(Order.streamPrefix).toBe("Order");
  });

  it("getUpcasters returns empty array by default", () => {
    expect(Order.getUpcasters()).toEqual([]);
  });

  describe("load", () => {
    it("returns null state for non-existent stream", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      const agg = await Order.load(store, "nonexistent");
      expect(agg.state).toBeNull();
      expect(agg.version).toBe(0);
      expect(agg.streamId).toBe("Order-nonexistent");
    });

    it("replays events to build state", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 99 } },
          { type: "OrderShipped", data: { tracking: "T1" } },
        ],
      });

      const agg = await Order.load(store, "1");
      expect(agg.version).toBe(2);
      expect(agg.state).toEqual({ status: "shipped", total: 99 });
    });

    it("ignores snapshot events while preserving the true stream version", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await Order.append(store, {
        entityId: "mixed-snapshot-load",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 75 } }],
      });
      await store.appendSnapshot({
        streamId: "Order-mixed-snapshot-load",
        expectedVersion: 1,
        events: [{ type: "OrderSummarySnapshot", data: { status: "placed" } }],
      });
      await Order.append(store, {
        entityId: "mixed-snapshot-load",
        expectedVersion: 2,
        events: [{ type: "OrderShipped", data: { tracking: "T2" } }],
      });

      const agg = await Order.load(store, "mixed-snapshot-load");

      expect(agg.version).toBe(3);
      expect(agg.state).toEqual({ status: "shipped", total: 75 });
    });
  });

  describe("loadEvents", () => {
    it("loads aggregate events from the aggregate stream", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await Order.append(store, {
        entityId: "typed-events",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 50 } },
          { type: "OrderShipped", data: { tracking: "X" } },
        ],
      });

      const events = await Order.loadEvents(store, "typed-events");

      expect(events.map((event) => event.type)).toEqual([
        "OrderPlaced",
        "OrderShipped",
      ]);
      const placed = events.find(isOrderPlacedEvent);
      expect(placed?.data.total).toBe(50);
    });

    it("filters generated snapshot events from typed aggregate events", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await Order.append(store, {
        entityId: "typed-events-with-snapshot",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 60 } }],
      });
      await store.appendSnapshot({
        streamId: "Order-typed-events-with-snapshot",
        expectedVersion: 1,
        events: [{ type: "OrderStateSnapshot", data: { status: "placed" } }],
      });
      await Order.append(store, {
        entityId: "typed-events-with-snapshot",
        expectedVersion: 2,
        events: [{ type: "OrderShipped", data: { tracking: "T3" } }],
      });

      const events = await Order.loadEvents(
        store,
        "typed-events-with-snapshot",
      );

      expect(events.map((event) => event.type)).toEqual([
        "OrderPlaced",
        "OrderShipped",
      ]);
    });
  });

  describe("subscribe", () => {
    it("subscribes to the aggregate stream", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();
      await Order.append(store, {
        entityId: "subscribed",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 10 } }],
      });

      const ac = new AbortController();
      let received: OrderStoredEvent | null = null;
      for await (const event of Order.subscribe(store, "subscribed", {
        pollIntervalMs: 25,
        signal: ac.signal,
      })) {
        received = event;
        ac.abort();
        break;
      }

      expect(received?.type).toBe("OrderPlaced");
      if (received?.type !== "OrderPlaced") {
        throw new Error("Expected OrderPlaced event");
      }
      expect(received.data.total).toBe(10);
    });
  });

  describe("append", () => {
    it("appends events and returns version range", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      const result = await Order.append(store, {
        entityId: "a1",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 50 } },
          { type: "OrderShipped", data: { tracking: "X" } },
        ],
      });

      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(2);

      const agg = await Order.load(store, "a1");
      expect(agg.state?.status).toBe("shipped");
    });

    it("rejects aggregate events ending in Snapshot", async () => {
      type ReservedEvents = {
        OrderSnapshot: { status: string };
      };

      const ReservedOrder = defineAggregate<OrderState, ReservedEvents>()({
        streamPrefix: "ReservedOrder",
        evolve: {
          OrderSnapshot: (state, event) => ({
            ...state,
            status: event.data?.status ?? "unknown",
            total: 0,
          }),
        },
      });
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await expect(
        ReservedOrder.append(store, {
          entityId: "reserved",
          expectedVersion: -1,
          events: [{ type: "OrderSnapshot", data: { status: "reserved" } }],
        }),
      ).rejects.toThrow(ReservedSnapshotEventTypeError);
    });
  });

  describe("upcasters", () => {
    it("returns registered upcasters", () => {
      const upcaster = {
        eventType: "OrderPlaced",
        fromSchemaVersion: 1,
        toSchemaVersion: 2,
        upcast: (data: Record<string, unknown>) => ({
          ...data,
          currency: "EUR",
        }),
      };

      const AggWithUpcasters = defineAggregate<OrderState, OrderEvents>()({
        streamPrefix: "UpcOrder",
        evolve: {
          OrderPlaced: (s) => s!,
          OrderShipped: (s) => s!,
          OrderCancelled: (s) => s!,
        },
        upcasters: [upcaster],
      });

      expect(AggWithUpcasters.getUpcasters()).toEqual([upcaster]);
    });
  });

  describe("encryption config", () => {
    type UserEvents = {
      UserRegistered: { name: string; email: string; age: number };
    };

    type UserState = { name: string; email: string; age: number };

    const EncryptedUser = defineAggregate<UserState, UserEvents>()({
      streamPrefix: "EncUser",
      evolve: {
        UserRegistered: (_state, event) => ({
          name: event.data?.name ?? "",
          email: event.data?.email ?? "",
          age: event.data?.age ?? 0,
        }),
      },
      encryption: {
        cryptoKeyId: (entityId) => `user:${entityId}`,
        encryptedFields: {
          UserRegistered: ["name", "email"],
        },
      },
    });

    it("appends with encryption and loads decrypted state", async () => {
      const store = new EventStore({
        pool,
        schema: uniqueSchema(),
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();
      await store.createCryptoKey("user:enc1");

      await EncryptedUser.append(store, {
        entityId: "enc1",
        expectedVersion: -1,
        events: [
          {
            type: "UserRegistered",
            data: { name: "Alice", email: "alice@test.com", age: 30 },
          },
        ],
      });

      const agg = await EncryptedUser.load(store, "enc1");
      expect(agg.state?.name).toBe("Alice");
      expect(agg.state?.email).toBe("alice@test.com");
      expect(agg.state?.age).toBe(30);
    });

    it("does not encrypt events without encryptedFields mapping", async () => {
      type MixedEvents = {
        Public: { info: string };
        Private: { secret: string };
      };

      const MixedAgg = defineAggregate<
        { info: string; secret: string },
        MixedEvents
      >()({
        streamPrefix: "Mixed",
        evolve: {
          Public: (s, e) => ({ ...s, info: e.data?.info ?? "" }),
          Private: (s, e) => ({ ...s, secret: e.data?.secret ?? "" }),
        },
        encryption: {
          cryptoKeyId: (id) => `mix:${id}`,
          encryptedFields: {
            Private: ["secret"],
            // Public has no encrypted fields
          },
        },
      });

      const store = new EventStore({
        pool,
        schema: uniqueSchema(),
        masterEncryptionKey: testMasterKey(),
      });
      await store.setup();
      await store.createCryptoKey("mix:m1");

      // Public event — no encryption needed, no cryptoKeyId resolved
      await MixedAgg.append(store, {
        entityId: "m1",
        expectedVersion: -1,
        events: [{ type: "Public", data: { info: "hello" } }],
      });

      const agg = await MixedAgg.load(store, "m1");
      expect(agg.state?.info).toBe("hello");
    });
  });
});
