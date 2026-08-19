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
  InvalidArgumentError,
  InvalidSchemaNameError,
  OptimisticConcurrencyError,
  CryptoSecretsRequiredError,
} from "./errors";
import { MAX_READ_EVENTS_PAGE_LIMIT } from "./input-validation";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

function makeStore(opts?: { schema?: string; source?: string }) {
  return new EventStore({
    pool,
    schema: opts?.schema ?? uniqueSchema(),
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

    it("ignores malformed environment secrets when explicit secrets are provided", () => {
      const previous = process.env.GDPR_CRYPTO_SECRETS;
      process.env.GDPR_CRYPTO_SECRETS = "not-a-versioned-secret";
      try {
        expect(
          () =>
            new EventStore({
              pool,
              schema: uniqueSchema(),
              secrets: {
                currentVersion: 1,
                secrets: [{ version: 1, value: "explicit-secret" }],
              },
            }),
        ).not.toThrow();
      } finally {
        if (previous === undefined) delete process.env.GDPR_CRYPTO_SECRETS;
        else process.env.GDPR_CRYPTO_SECRETS = previous;
      }
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
      await expect(store.loadFrom("s-1", { fromVersion: 1 })).rejects.toThrow(
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
    it("throws CryptoSecretsRequiredError for crypto ops without secrets", async () => {
      const store = makeStore();
      await store.setup();
      await expect(store.createCryptoKey("k1")).rejects.toThrow(
        CryptoSecretsRequiredError,
      );
      await expect(store.revokeKey("k1")).rejects.toThrow(
        CryptoSecretsRequiredError,
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

      const events = await store.loadFrom("LF-1", { fromVersion: 2 });
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
      } catch (error) {
        expect(error).toBeInstanceOf(OptimisticConcurrencyError);
        const err = error as OptimisticConcurrencyError;
        expect(err.streamId).toBe("OCC-4");
        expect(err.expectedVersion).toBe(1);
        expect(err.actualVersion).toBe(2);
      }
    });

    it("blocks a concurrent append on the same stream", async () => {
      const schema = uniqueSchema();
      const store = new EventStore({ pool, schema });
      await store.setup();
      const streamId = "LOCK-1";

      const firstClient = await pool.connect();
      const secondClient = await pool.connect();
      let firstTransactionActive = false;
      let secondTransactionActive = false;

      try {
        await firstClient.query("BEGIN");
        firstTransactionActive = true;
        await store.append(
          {
            streamId,
            expectedVersion: -1,
            events: [{ type: "A", data: {} }],
          },
          { client: firstClient },
        );

        await secondClient.query("BEGIN");
        secondTransactionActive = true;
        await secondClient.query("SET LOCAL lock_timeout = '50ms'");

        await expect(
          store.append(
            {
              streamId,
              expectedVersion: 1,
              events: [{ type: "B", data: {} }],
            },
            { client: secondClient },
          ),
        ).rejects.toMatchObject({ code: "55P03" });

        await secondClient.query("ROLLBACK");
        secondTransactionActive = false;
        await firstClient.query("COMMIT");
        firstTransactionActive = false;

        await expect(store.load(streamId)).resolves.toMatchObject([
          { type: "A", streamVersion: 1 },
        ]);
      } finally {
        if (secondTransactionActive) await secondClient.query("ROLLBACK");
        if (firstTransactionActive) await firstClient.query("ROLLBACK");
        secondClient.release();
        firstClient.release();
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

  describe("readEventsPage", () => {
    it("reads empty, unknown, and deleted streams without failing", async () => {
      const schema = uniqueSchema();
      const store = makeStore({ schema });
      await store.setup();
      await store.append({
        streamId: "PAGE-populated",
        expectedVersion: -1,
        events: [{ type: "Created", data: { value: 1 } }],
      });
      await store.append({
        streamId: "PAGE-deleted",
        expectedVersion: -1,
        events: [{ type: "Deleted", data: {} }],
      });
      await pool.query(`DELETE FROM ${schema}.events WHERE stream_id = $1`, [
        "PAGE-deleted",
      ]);

      const page = await store.readEventsPage({
        streamIds: [
          "PAGE-empty",
          "PAGE-populated",
          "PAGE-unknown",
          "PAGE-deleted",
        ],
        limit: 10,
      });

      expect(page.events.map((event) => event.streamId)).toEqual([
        "PAGE-populated",
      ]);
      expect(page.hasNextPage).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it("pages interleaved streams in ascending order with exact boundaries", async () => {
      const store = makeStore();
      await store.setup();
      await store.append({
        streamId: "PAGE-A",
        expectedVersion: -1,
        events: [{ type: "A1", data: {} }],
      });
      await store.append({
        streamId: "PAGE-B",
        expectedVersion: -1,
        events: [{ type: "B1", data: {} }],
      });
      await store.append({
        streamId: "PAGE-A",
        expectedVersion: 1,
        events: [{ type: "A2", data: {} }],
      });

      const first = await store.readEventsPage({
        streamIds: ["PAGE-B", "PAGE-A"],
        limit: 2,
      });
      expect(first.events.map((event) => event.type)).toEqual(["A1", "B1"]);
      expect(first.hasNextPage).toBe(true);
      expect(first.nextCursor).not.toBeNull();

      const second = await store.readEventsPage({
        streamIds: ["PAGE-A", "PAGE-B"],
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.events.map((event) => event.type)).toEqual(["A2"]);
      expect(second.hasNextPage).toBe(false);
      expect(second.nextCursor).toBeNull();
    });

    it("supports deterministic descending pages and stable cursor reuse", async () => {
      const store = makeStore();
      await store.setup();
      await store.append({
        streamId: "PAGE-D",
        expectedVersion: -1,
        events: [
          { type: "D1", data: {} },
          { type: "D2", data: {} },
          { type: "D3", data: {} },
        ],
      });

      const first = await store.readEventsPage({
        streamIds: ["PAGE-D"],
        limit: 2,
        order: "desc",
      });
      expect(first.events.map((event) => event.type)).toEqual(["D3", "D2"]);
      expect(first.hasNextPage).toBe(true);

      const repeated = await store.readEventsPage({
        streamIds: ["PAGE-D"],
        limit: 2,
        order: "desc",
        cursor: first.nextCursor!,
      });
      const again = await store.readEventsPage({
        streamIds: ["PAGE-D"],
        limit: 2,
        order: "desc",
        cursor: first.nextCursor!,
      });
      expect(repeated.events.map((event) => event.id)).toEqual(
        again.events.map((event) => event.id),
      );
      expect(repeated.nextCursor).toBe(again.nextCursor);
      expect(repeated.events.map((event) => event.type)).toEqual(["D1"]);
      expect(repeated.nextCursor).toBeNull();
    });

    it("excludes appends after the initial cursor boundary", async () => {
      const store = makeStore();
      await store.setup();
      await store.append({
        streamId: "PAGE-concurrent",
        expectedVersion: -1,
        events: [
          { type: "C1", data: {} },
          { type: "C2", data: {} },
          { type: "C3", data: {} },
        ],
      });

      const first = await store.readEventsPage({
        streamIds: ["PAGE-concurrent"],
        limit: 1,
      });
      await store.append({
        streamId: "PAGE-concurrent",
        expectedVersion: 3,
        events: [{ type: "C4", data: {} }],
      });

      const pageTypes: string[] = first.events.map((event) => event.type);
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await store.readEventsPage({
          streamIds: ["PAGE-concurrent"],
          limit: 1,
          cursor,
        });
        pageTypes.push(...page.events.map((event) => event.type));
        cursor = page.nextCursor;
      }
      expect(pageTypes).toEqual(["C1", "C2", "C3"]);
    });

    it("keeps a cursor stable when a lower position commits after the first page", async () => {
      const schema = uniqueSchema();
      const store = makeStore({ schema });
      await store.setup();
      await store.append({
        streamId: "PAGE-baseline",
        expectedVersion: -1,
        events: [
          { type: "B1", data: {} },
          { type: "B2", data: {} },
        ],
      });

      const baselineTransaction = await pool.connect();
      const lateTransaction = await pool.connect();
      try {
        await baselineTransaction.query("BEGIN");
        await baselineTransaction.query("SELECT pg_current_xact_id()");
        await lateTransaction.query("BEGIN");
        await store.append(
          {
            streamId: "PAGE-slow",
            expectedVersion: -1,
            events: [{ type: "Slow", data: {} }],
          },
          { client: lateTransaction },
        );
        await store.append(
          {
            streamId: "PAGE-baseline",
            expectedVersion: 2,
            events: [
              { type: "B3", data: {} },
              { type: "B4", data: {} },
            ],
          },
          { client: baselineTransaction },
        );
        await baselineTransaction.query("COMMIT");

        const first = await store.readEventsPage({
          streamIds: ["PAGE-baseline", "PAGE-slow"],
          limit: 2,
        });
        expect(first.nextCursor).not.toBeNull();
        const beforeCommit = await store.readEventsPage({
          streamIds: ["PAGE-baseline", "PAGE-slow"],
          limit: 2,
          cursor: first.nextCursor!,
        });

        await lateTransaction.query("COMMIT");

        const afterCommit = await store.readEventsPage({
          streamIds: ["PAGE-baseline", "PAGE-slow"],
          limit: 2,
          cursor: first.nextCursor!,
        });
        expect(afterCommit.events.map((event) => event.id)).toEqual(
          beforeCommit.events.map((event) => event.id),
        );
        expect(afterCommit.nextCursor).toBe(beforeCommit.nextCursor);
      } finally {
        await baselineTransaction.query("ROLLBACK");
        baselineTransaction.release();
        await lateTransaction.query("ROLLBACK");
        lateTransaction.release();
      }
    });

    it("keeps large bigint positions exact in events and cursors", async () => {
      const schema = uniqueSchema();
      const store = makeStore({ schema });
      await store.setup();
      await pool.query(
        `SELECT setval(pg_get_serial_sequence($1, 'global_position'), $2::bigint, false)`,
        [`${schema}.events`, "9007199254740993"],
      );
      await store.append({
        streamId: "PAGE-bigint",
        expectedVersion: -1,
        events: [
          { type: "Big1", data: {} },
          { type: "Big2", data: {} },
        ],
      });

      const page = await store.readEventsPage({
        streamIds: ["PAGE-bigint"],
        limit: 1,
      });
      expect(page.events[0].globalPosition).toBe(9007199254740993n);
      expect(page.nextCursor).not.toBeNull();
      const decoded = JSON.parse(
        Buffer.from(page.nextCursor!, "base64url").toString("utf8"),
      ) as { globalPosition: string; watermark: string };
      expect(decoded.globalPosition).toBe("9007199254740993");
      expect(decoded.watermark).toBe("9007199254740994");
    });

    it("rejects a cursor with changed stream scope or order and enforces the limit", async () => {
      const store = makeStore();
      await store.setup();
      await store.append({
        streamId: "PAGE-validation",
        expectedVersion: -1,
        events: [
          { type: "V1", data: {} },
          { type: "V2", data: {} },
        ],
      });
      const first = await store.readEventsPage({
        streamIds: ["PAGE-validation"],
        limit: 1,
      });
      await expect(
        store.readEventsPage({
          streamIds: ["PAGE-validation", "PAGE-other"],
          limit: 1,
          cursor: first.nextCursor!,
        }),
      ).rejects.toThrow(InvalidArgumentError);
      await expect(
        store.readEventsPage({
          streamIds: [],
          limit: 1,
          cursor: first.nextCursor!,
        }),
      ).rejects.toThrow(InvalidArgumentError);
      await expect(
        store.readEventsPage({
          streamIds: ["PAGE-validation"],
          limit: 1,
          order: "desc",
          cursor: first.nextCursor!,
        }),
      ).rejects.toThrow(InvalidArgumentError);
      await expect(
        store.readEventsPage({
          streamIds: ["PAGE-validation"],
          limit: MAX_READ_EVENTS_PAGE_LIMIT + 1,
        }),
      ).rejects.toThrow(InvalidArgumentError);
    });
  });
});
