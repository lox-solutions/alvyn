import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "./event-store";
import {
  startPostgres,
  stopPostgres,
  createTestPool,
  uniqueSchema,
} from "./__tests__/setup";
import {
  EventStoreNotInitializedError,
  InvalidSchemaNameError,
  OptimisticConcurrencyError,
  MasterKeyRequiredError,
} from "./errors";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

function makeStore(opts?: {
  schema?: string;
  masterKey?: string;
  source?: string;
}) {
  return new EventStore({
    pool,
    schema: opts?.schema ?? uniqueSchema(),
    masterEncryptionKey: opts?.masterKey,
    defaultSource: opts?.source,
  });
}

describe("EventStore", () => {
  // ---------------------------------------------------------------------------
  // Constructor & Schema Validation
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("throws InvalidSchemaNameError for invalid schema names", () => {
      expect(() => makeStore({ schema: "DROP TABLE;" })).toThrow(
        InvalidSchemaNameError,
      );
      expect(() => makeStore({ schema: "1bad" })).toThrow(
        InvalidSchemaNameError,
      );
      expect(() => makeStore({ schema: "" })).toThrow(InvalidSchemaNameError);
      expect(() => makeStore({ schema: "UPPER" })).toThrow(
        InvalidSchemaNameError,
      );
    });

    it("accepts valid schema names", () => {
      expect(() => makeStore({ schema: "event_store" })).not.toThrow();
      expect(() => makeStore({ schema: "a" })).not.toThrow();
      expect(() => makeStore({ schema: "_private" })).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // setup() / ensureInitialized
  // ---------------------------------------------------------------------------

  describe("setup", () => {
    it("creates schema and tables (idempotent)", async () => {
      const store = makeStore();
      await store.setup();
      // Second call should not throw
      await store.setup();
    });

    it("throws EventStoreNotInitializedError if methods called before setup", async () => {
      const store = makeStore();
      await expect(store.load("s-1")).rejects.toThrow(
        EventStoreNotInitializedError,
      );
      await expect(
        store.append({
          streamId: "s-1",
          expectedVersion: -1,
          events: [{ type: "T", data: {} }],
        }),
      ).rejects.toThrow(EventStoreNotInitializedError);
      await expect(store.getStreamVersion("s-1")).rejects.toThrow(
        EventStoreNotInitializedError,
      );
      await expect(store.listStreams()).rejects.toThrow(
        EventStoreNotInitializedError,
      );
      await expect(store.loadFrom("s-1", 1)).rejects.toThrow(
        EventStoreNotInitializedError,
      );
      await expect(store.loadWithSnapshot("s-1")).rejects.toThrow(
        EventStoreNotInitializedError,
      );
      await expect(
        store.saveSnapshot({
          streamId: "s-1",
          streamVersion: 1,
          snapshotType: "t",
          data: {},
        }),
      ).rejects.toThrow(EventStoreNotInitializedError);
      await expect(store.deleteSnapshot("s-1")).rejects.toThrow(
        EventStoreNotInitializedError,
      );
      await expect(
        store.processOutbox(() => Promise.resolve()),
      ).rejects.toThrow(EventStoreNotInitializedError);
      await expect(store.cleanupOutbox()).rejects.toThrow(
        EventStoreNotInitializedError,
      );
      await expect(
        store.runProjection({
          projectionName: "p",
          handle: () => Promise.resolve(),
        }),
      ).rejects.toThrow(EventStoreNotInitializedError);
      await expect(
        store.withTransaction(() => Promise.resolve()),
      ).rejects.toThrow(EventStoreNotInitializedError);
      await expect(store.withRetry(() => Promise.resolve())).rejects.toThrow(
        EventStoreNotInitializedError,
      );
    });

    it("registerUpcaster works before setup", () => {
      const store = makeStore();
      expect(() =>
        store.registerUpcaster({
          eventType: "A",
          fromSchemaVersion: 1,
          toSchemaVersion: 2,
          upcast: (d: unknown) => d,
        }),
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Crypto guard
  // ---------------------------------------------------------------------------

  describe("crypto guard", () => {
    it("throws MasterKeyRequiredError for crypto ops without master key", async () => {
      const store = makeStore();
      await store.setup();
      await expect(store.createCryptoKey("k1")).rejects.toThrow(
        MasterKeyRequiredError,
      );
      await expect(store.revokeKey("k1")).rejects.toThrow(
        MasterKeyRequiredError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // append + load (core CRUD)
  // ---------------------------------------------------------------------------

  describe("append and load", () => {
    it("appends a single event and loads it back", async () => {
      const store = makeStore();
      await store.setup();

      const result = await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 99.99 } }],
      });

      expect(result.streamId).toBe("Order-1");
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(1);
      expect(result.globalPositions).toHaveLength(1);

      const events = await store.load("Order-1");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("OrderPlaced");
      expect(events[0].data).toEqual({ total: 99.99 });
      expect(events[0].streamId).toBe("Order-1");
      expect(events[0].streamVersion).toBe(1);
      expect(events[0].specversion).toBe("1.0");
      expect(events[0].source).toBe("event-store");
      expect(events[0].subject).toBe("Order-1");
      expect(events[0].id).toBe("Order-1/1");
      expect(events[0].datacontenttype).toBe("application/json");
      expect(events[0].time).toBeTruthy();
    });

    it("appends multiple events in sequence", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "Order-2",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 50 } }],
      });

      const r2 = await store.append({
        streamId: "Order-2",
        expectedVersion: 1,
        events: [
          { type: "OrderShipped", data: { tracking: "T1" } },
          { type: "OrderDelivered", data: {} },
        ],
      });

      expect(r2.fromVersion).toBe(2);
      expect(r2.toVersion).toBe(3);

      const events = await store.load("Order-2");
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.type)).toEqual([
        "OrderPlaced",
        "OrderShipped",
        "OrderDelivered",
      ]);
    });

    it("custom defaultSource appears on events", async () => {
      const store = makeStore({ source: "urn:test:my-service" });
      await store.setup();

      await store.append({
        streamId: "S-1",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });

      const events = await store.load("S-1");
      expect(events[0].source).toBe("urn:test:my-service");
    });

    it("per-event source override works", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "S-2",
        expectedVersion: -1,
        events: [{ type: "A", data: {}, source: "urn:override" }],
      });

      const events = await store.load("S-2");
      expect(events[0].source).toBe("urn:override");
    });

    it("stores extension attributes", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "S-3",
        expectedVersion: -1,
        events: [
          {
            type: "A",
            data: {},
            extensions: { correlationid: "corr-1", actorid: "user-1" },
          },
        ],
      });

      const events = await store.load("S-3");
      expect(events[0].extensions.correlationid).toBe("corr-1");
      expect(events[0].extensions.actorid).toBe("user-1");
      expect(events[0].extensions.schemaversion).toBe(1);
    });

    it("rejects zero events", async () => {
      const store = makeStore();
      await store.setup();

      await expect(
        store.append({ streamId: "S-4", expectedVersion: -1, events: [] }),
      ).rejects.toThrow("Cannot append zero events");
    });
  });

  // ---------------------------------------------------------------------------
  // loadFrom + maxEvents
  // ---------------------------------------------------------------------------

  describe("loadFrom", () => {
    it("loads events from a specific version", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "LF-1",
        expectedVersion: -1,
        events: [
          { type: "A", data: { n: 1 } },
          { type: "B", data: { n: 2 } },
          { type: "C", data: { n: 3 } },
        ],
      });

      const events = await store.loadFrom("LF-1", 2);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("B");
      expect(events[1].type).toBe("C");
    });

    it("respects maxEvents limit", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "LF-2",
        expectedVersion: -1,
        events: [
          { type: "A", data: {} },
          { type: "B", data: {} },
          { type: "C", data: {} },
        ],
      });

      const events = await store.load("LF-2", 2);
      expect(events).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // getStreamVersion
  // ---------------------------------------------------------------------------

  describe("getStreamVersion", () => {
    it("returns 0 for non-existent stream", async () => {
      const store = makeStore();
      await store.setup();
      expect(await store.getStreamVersion("nonexistent")).toBe(0);
    });

    it("returns current version after appends", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "V-1",
        expectedVersion: -1,
        events: [
          { type: "A", data: {} },
          { type: "B", data: {} },
        ],
      });

      expect(await store.getStreamVersion("V-1")).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // listStreams
  // ---------------------------------------------------------------------------

  describe("listStreams", () => {
    it("lists all streams", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });
      await store.append({
        streamId: "User-1",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });

      const streams = await store.listStreams();
      expect(streams).toContain("Order-1");
      expect(streams).toContain("User-1");
    });

    it("filters by prefix", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });
      await store.append({
        streamId: "User-1",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });

      const streams = await store.listStreams({ prefix: "Order" });
      expect(streams).toEqual(["Order-1"]);
    });

    it("respects limit", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "S-1",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });
      await store.append({
        streamId: "S-2",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });

      const streams = await store.listStreams({ limit: 1 });
      expect(streams).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Optimistic Concurrency Control
  // ---------------------------------------------------------------------------

  describe("optimistic concurrency control", () => {
    it("expectedVersion -1 fails if stream already exists", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "OCC-1",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });

      await expect(
        store.append({
          streamId: "OCC-1",
          expectedVersion: -1,
          events: [{ type: "B", data: {} }],
        }),
      ).rejects.toThrow(OptimisticConcurrencyError);
    });

    it("expectedVersion N fails if stream is at different version", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "OCC-2",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });

      await expect(
        store.append({
          streamId: "OCC-2",
          expectedVersion: 5,
          events: [{ type: "B", data: {} }],
        }),
      ).rejects.toThrow(OptimisticConcurrencyError);
    });

    it("expectedVersion 0 skips concurrency check", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "OCC-3",
        expectedVersion: -1,
        events: [{ type: "A", data: {} }],
      });

      // Should succeed regardless of current version
      const result = await store.append({
        streamId: "OCC-3",
        expectedVersion: 0,
        events: [{ type: "B", data: {} }],
      });

      expect(result.fromVersion).toBe(2);
    });

    it("OCC error has correct properties", async () => {
      const store = makeStore();
      await store.setup();

      await store.append({
        streamId: "OCC-4",
        expectedVersion: -1,
        events: [
          { type: "A", data: {} },
          { type: "B", data: {} },
        ],
      });

      try {
        await store.append({
          streamId: "OCC-4",
          expectedVersion: 1,
          events: [{ type: "C", data: {} }],
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OptimisticConcurrencyError);
        const err = e as OptimisticConcurrencyError;
        expect(err.streamId).toBe("OCC-4");
        expect(err.expectedVersion).toBe(1);
        expect(err.actualVersion).toBe(2);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // withTransaction
  // ---------------------------------------------------------------------------

  describe("withTransaction", () => {
    it("commits on success", async () => {
      const store = makeStore();
      await store.setup();

      await store.withTransaction(async (client) => {
        await store.append(
          {
            streamId: "TX-1",
            expectedVersion: -1,
            events: [{ type: "A", data: {} }],
          },
          { client },
        );
      });

      const events = await store.load("TX-1");
      expect(events).toHaveLength(1);
    });

    it("rolls back on error", async () => {
      const store = makeStore();
      await store.setup();

      await expect(
        store.withTransaction(async (client) => {
          await store.append(
            {
              streamId: "TX-2",
              expectedVersion: -1,
              events: [{ type: "A", data: {} }],
            },
            { client },
          );
          throw new Error("Boom");
        }),
      ).rejects.toThrow("Boom");

      const events = await store.load("TX-2");
      expect(events).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // withRetry
  // ---------------------------------------------------------------------------

  describe("withRetry", () => {
    it("succeeds on first attempt", async () => {
      const store = makeStore();
      await store.setup();

      let attempts = 0;
      const result = await store.withRetry(() => {
        attempts++;
        return Promise.resolve("ok");
      });

      expect(result).toBe("ok");
      expect(attempts).toBe(1);
    });

    it("retries on OptimisticConcurrencyError", async () => {
      const store = makeStore();
      await store.setup();

      let attempts = 0;
      await store.withRetry(() => {
        attempts++;
        if (attempts < 3) {
          throw new OptimisticConcurrencyError("s", 1, 2);
        }
        return Promise.resolve();
      });

      expect(attempts).toBe(3);
    });

    it("throws immediately on non-OCC error", async () => {
      const store = makeStore();
      await store.setup();

      let attempts = 0;
      await expect(
        store.withRetry(() => {
          attempts++;
          throw new Error("Not OCC");
        }),
      ).rejects.toThrow("Not OCC");

      expect(attempts).toBe(1);
    });

    it("throws after max retries exhausted", async () => {
      const store = makeStore();
      await store.setup();

      let attempts = 0;
      await expect(
        store.withRetry(() => {
          attempts++;
          throw new OptimisticConcurrencyError("s", 1, 2);
        }, 2),
      ).rejects.toThrow(OptimisticConcurrencyError);

      expect(attempts).toBe(3); // initial + 2 retries
    });
  });

  // ---------------------------------------------------------------------------
  // Upcasters (integration)
  // ---------------------------------------------------------------------------

  describe("upcasters", () => {
    it("applies registered upcasters during load", async () => {
      const store = makeStore();
      await store.setup();

      // Append v1 event
      await store.append({
        streamId: "UP-1",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 100 }, schemaVersion: 1 },
        ],
      });

      // Register v1->v2 upcaster
      store.registerUpcaster({
        eventType: "OrderPlaced",
        fromSchemaVersion: 1,
        toSchemaVersion: 2,
        upcast: (data: unknown) => ({
          ...(data as Record<string, unknown>),
          currency: "EUR",
        }),
      });

      const events = await store.load("UP-1");
      expect(events[0].data).toEqual({ total: 100, currency: "EUR" });
    });
  });

  describe("load edge cases", () => {
    it("returns empty array for nonexistent stream", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      const events = await store.load("Nonexistent-xyz");
      expect(events).toEqual([]);
    });
  });
});
