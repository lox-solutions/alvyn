import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "../event-store";
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

const Order = defineAggregate<OrderEvents>()({
  streamPrefix: "Order",
  initialState: (): OrderState => ({ status: "new", total: 0 }),
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
    it("returns initial state for non-existent stream", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      const agg = await Order.load(store, "nonexistent");
      expect(agg.exists).toBe(false);
      expect(agg.version).toBe(0);
      expect(agg.state).toEqual({ status: "new", total: 0 });
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
      expect(agg.exists).toBe(true);
      expect(agg.version).toBe(2);
      expect(agg.state).toEqual({ status: "shipped", total: 99 });
    });
  });

  describe("append", () => {
    it("appends events and returns version range", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      const result = await Order.append(store, "a1", {
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 50 } },
          { type: "OrderShipped", data: { tracking: "X" } },
        ],
      });

      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(2);

      const agg = await Order.load(store, "a1");
      expect(agg.state.status).toBe("shipped");
    });
  });

  describe("snapshot support", () => {
    const SnapOrder = defineAggregate<OrderEvents>()({
      streamPrefix: "SnapOrder",
      initialState: (): OrderState => ({ status: "new", total: 0 }),
      evolve: {
        OrderPlaced: (state, event) => ({
          ...state,
          status: "placed",
          total: event.data?.total ?? 0,
        }),
        OrderShipped: (state) => ({ ...state, status: "shipped" }),
        OrderCancelled: (state) => ({ ...state, status: "cancelled" }),
      },
      snapshot: { every: 2 },
    });

    it("auto-creates snapshot after N events", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "SnapOrder-s1",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 10 } },
          { type: "OrderShipped", data: { tracking: "T" } },
        ],
      });

      // Load triggers auto-snapshot (2 events >= every:2)
      const agg = await SnapOrder.load(store, "s1");
      expect(agg.state.status).toBe("shipped");

      // Verify snapshot was saved
      const { snapshot } = await store.loadWithSnapshot("SnapOrder-s1");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.streamVersion).toBe(2);
    });

    it("loads from snapshot + remaining events", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      // Append 3 events
      await store.append({
        streamId: "SnapOrder-s2",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 20 } },
          { type: "OrderShipped", data: { tracking: "T" } },
          { type: "OrderCancelled", data: {} },
        ],
      });

      // First load: creates snapshot at v3 (3 >= every:2)
      await SnapOrder.load(store, "s2");

      // Append one more event
      await store.append({
        streamId: "SnapOrder-s2",
        expectedVersion: 3,
        events: [{ type: "OrderPlaced", data: { total: 30 } }],
      });

      // Second load: snapshot at v3, replay event at v4
      const agg = await SnapOrder.load(store, "s2");
      expect(agg.version).toBe(4);
      expect(agg.state.total).toBe(30);
      expect(agg.state.status).toBe("placed");
    });
  });

  describe("Map/Set snapshot restoration", () => {
    type TagEvents = {
      TagAdded: { tag: string };
    };

    type TagState = {
      tags: Set<string>;
      metadata: Map<string, number>;
    };

    const TagAggregate = defineAggregate<TagEvents>()({
      streamPrefix: "Tag",
      initialState: (): TagState => ({
        tags: new Set(),
        metadata: new Map(),
      }),
      evolve: {
        TagAdded: (state, event) => {
          const tags = new Set(state.tags);
          const tag = event.data?.tag ?? "";
          tags.add(tag);
          const metadata = new Map(state.metadata);
          metadata.set(tag, (metadata.get(tag) ?? 0) + 1);
          return { tags, metadata };
        },
      },
      snapshot: { every: 1 },
    });

    it("restores Map and Set fields from snapshot", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Tag-t1",
        expectedVersion: -1,
        events: [{ type: "TagAdded", data: { tag: "important" } }],
      });

      // First load creates snapshot
      const agg1 = await TagAggregate.load(store, "t1");
      expect(agg1.state.tags).toBeInstanceOf(Set);
      expect(agg1.state.tags.has("important")).toBe(true);

      // Add another event so second load uses snapshot + replay
      await store.append({
        streamId: "Tag-t1",
        expectedVersion: 1,
        events: [{ type: "TagAdded", data: { tag: "urgent" } }],
      });

      const agg2 = await TagAggregate.load(store, "t1");
      expect(agg2.state.tags).toBeInstanceOf(Set);
      expect(agg2.state.tags.has("important")).toBe(true);
      expect(agg2.state.tags.has("urgent")).toBe(true);
      expect(agg2.state.metadata).toBeInstanceOf(Map);
      expect(agg2.state.metadata.get("important")).toBe(1);
    });
  });

  describe("custom deserializeSnapshot", () => {
    type SimpleEvents = { Inc: { n: number } };
    type SimpleState = { count: number };

    const CustomSnap = defineAggregate<SimpleEvents>()({
      streamPrefix: "Custom",
      initialState: (): SimpleState => ({ count: 0 }),
      evolve: {
        Inc: (state, event) => ({ count: state.count + (event.data?.n ?? 0) }),
      },
      snapshot: { every: 1 },
      deserializeSnapshot: (raw) => {
        const r = raw as { count: number };
        return { count: r.count * 10 }; // Custom transform
      },
    });

    it("uses custom deserializer", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Custom-c1",
        expectedVersion: -1,
        events: [{ type: "Inc", data: { n: 5 } }],
      });

      // First load creates snapshot with count:5
      await CustomSnap.load(store, "c1");

      // Add event so next load uses snapshot
      await store.append({
        streamId: "Custom-c1",
        expectedVersion: 1,
        events: [{ type: "Inc", data: { n: 1 } }],
      });

      // Snapshot count=5, custom deserialize → 50, then +1 from event = 51
      const agg = await CustomSnap.load(store, "c1");
      expect(agg.state.count).toBe(51);
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

      const AggWithUpcasters = defineAggregate<OrderEvents>()({
        streamPrefix: "UpcOrder",
        initialState: (): OrderState => ({ status: "new", total: 0 }),
        evolve: {
          OrderPlaced: (s) => s,
          OrderShipped: (s) => s,
          OrderCancelled: (s) => s,
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

    const EncryptedUser = defineAggregate<UserEvents>()({
      streamPrefix: "EncUser",
      initialState: (): UserState => ({ name: "", email: "", age: 0 }),
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

      await EncryptedUser.append(store, "enc1", {
        expectedVersion: -1,
        events: [
          {
            type: "UserRegistered",
            data: { name: "Alice", email: "alice@test.com", age: 30 },
          },
        ],
      });

      const agg = await EncryptedUser.load(store, "enc1");
      expect(agg.state.name).toBe("Alice");
      expect(agg.state.email).toBe("alice@test.com");
      expect(agg.state.age).toBe(30);
    });

    it("does not encrypt events without encryptedFields mapping", async () => {
      type MixedEvents = {
        Public: { info: string };
        Private: { secret: string };
      };

      const MixedAgg = defineAggregate<MixedEvents>()({
        streamPrefix: "Mixed",
        initialState: () => ({ info: "", secret: "" }),
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
      await MixedAgg.append(store, "m1", {
        expectedVersion: -1,
        events: [{ type: "Public", data: { info: "hello" } }],
      });

      const agg = await MixedAgg.load(store, "m1");
      expect(agg.state.info).toBe("hello");
    });
  });
});
