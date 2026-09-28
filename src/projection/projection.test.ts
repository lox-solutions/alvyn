import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "../event-store";
import { defineProjection } from "./define-projection";
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

type OrderEvents = {
  OrderPlaced: { total: number };
  OrderShipped: { tracking: string };
};

describe("Projections", () => {
  it("decrypts before upcasting historical events", async () => {
    const store = new EventStore({
      pool,
      schema: uniqueSchema(),
      secrets: {
        currentVersion: 1,
        secrets: [{ version: 1, value: "11".repeat(32) }],
      },
    });
    await store.setup();
    await store.createCryptoKey("user:1");
    await store.append({
      streamId: "User-1",
      expectedVersion: -1,
      events: [
        {
          type: "Registered",
          data: { name: "Alice" },
          schemaVersion: 1,
          encryptedFields: ["name"],
          cryptoKeyId: "user:1",
        },
      ],
    });
    store.registerUpcaster({
      eventType: "Registered",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast: (data: unknown) => ({
        displayName: (data as { name: string }).name,
      }),
    });
    const received: unknown[] = [];
    expect(
      await store.runProjection({
        projectionName: "private-user",
        handle: (event) => {
          received.push(event.data);
          return Promise.resolve();
        },
      }),
    ).toBe(1);
    expect(received).toEqual([{ displayName: "Alice" }]);
  });

  it("requires an explicit redaction policy, preserves public fields, and continues replay", async () => {
    const store = new EventStore({
      pool,
      schema: uniqueSchema(),
      secrets: {
        currentVersion: 1,
        secrets: [{ version: 1, value: "11".repeat(32) }],
      },
    });
    await store.setup();
    await store.createCryptoKey("user:1");
    await store.append({
      streamId: "Issue-1",
      expectedVersion: -1,
      events: [
        {
          type: "IssueCreated",
          data: { title: "Old", creator: { name: "Alice", id: 7 } },
          schemaVersion: 1,
          encryptedFields: ["creator.name"],
          cryptoKeyId: "user:1",
        },
      ],
    });
    await store.append({
      streamId: "Issue-1",
      expectedVersion: 1,
      events: [{ type: "IssueRenamed", data: { title: "New" } }],
    });
    store.registerUpcaster({
      eventType: "IssueCreated",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast: () => {
        throw new Error("redacted data must not be upcasted");
      },
    });
    await store.revokeKey("user:1");
    type IssueEvents = {
      IssueCreated: { title: string; creator: { name: string; id: number } };
      IssueRenamed: { title: string };
    };
    const received: unknown[] = [];
    const definition = {
      projectionName: "issues",
      streamPrefix: "Issue",
      handlers: {
        IssueCreated: () => {
          throw new Error("complete handler called on redacted event");
        },
        IssueRenamed: (data: { title: string }) => {
          received.push(data);
        },
      },
    };
    await expect(
      store.runProjection(defineProjection<IssueEvents>()(definition)),
    ).rejects.toThrow(/onRedacted policy/);
    const projection = defineProjection<IssueEvents>()({
      ...definition,
      onRedacted: (event, ctx) => {
        received.push({
          data: event.data,
          paths: event.redactedPaths,
          version: event.schemaVersion,
          id: ctx.entityId,
        });
      },
    });
    expect(await store.runProjection(projection)).toBe(2);
    expect(received).toEqual([
      {
        data: { title: "Old", creator: { id: 7, name: null } },
        paths: ["creator.name"],
        version: 1,
        id: "1",
      },
      { title: "New" },
    ]);
    expect(await store.runProjection(projection)).toBe(0);
  });

  it("skips redacted events only when explicitly configured", async () => {
    const store = new EventStore({
      pool,
      schema: uniqueSchema(),
      secrets: {
        currentVersion: 1,
        secrets: [{ version: 1, value: "11".repeat(32) }],
      },
    });
    await store.setup();
    await store.createCryptoKey("user:1");
    await store.append({
      streamId: "User-1",
      expectedVersion: -1,
      events: [
        {
          type: "Registered",
          data: { name: "Alice" },
          encryptedFields: ["name"],
          cryptoKeyId: "user:1",
        },
      ],
    });
    await store.revokeKey("user:1");
    const projection = {
      projectionName: "skip-private-user",
      onRedacted: "skip" as const,
      handle: () => {
        throw new Error("should not be called");
      },
    };
    expect(await store.runProjection(projection)).toBe(1);
    expect(await store.runProjection(projection)).toBe(0);
  });

  it("treats missing key rows and missing crypto configuration as errors, not redaction", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({
      pool,
      schema,
      secrets: {
        currentVersion: 1,
        secrets: [{ version: 1, value: "11".repeat(32) }],
      },
    });
    await store.setup();
    await store.createCryptoKey("user:1");
    await store.append({
      streamId: "User-1",
      expectedVersion: -1,
      events: [
        {
          type: "Registered",
          data: { name: "Alice" },
          encryptedFields: ["name"],
          cryptoKeyId: "user:1",
        },
      ],
    });
    const projection = {
      projectionName: "bad-key",
      onRedacted: "skip" as const,
      handle: () => Promise.resolve(),
    };
    const unconfigured = new EventStore({ pool, schema });
    await unconfigured.setup();
    await expect(unconfigured.runProjection(projection)).rejects.toThrow(
      /Crypto configuration required/,
    );
    await pool.query(`DELETE FROM ${schema}.crypto_keys WHERE key_id = $1`, [
      "user:1",
    ]);
    await expect(store.runProjection(projection)).rejects.toThrow(/not found/);
  });

  describe("defineProjection", () => {
    it("filters events by stream prefix", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 100 } }],
      });
      await store.append({
        streamId: "User-1",
        expectedVersion: -1,
        events: [{ type: "UserCreated", data: {} }],
      });

      const handled: string[] = [];
      const projection = defineProjection<OrderEvents>()({
        projectionName: "test-proj",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: (_data, ctx) => {
            handled.push(ctx.entityId);
          },
        },
      });

      await store.runProjection(projection);

      // Only Order events handled, User events skipped
      expect(handled).toEqual(["1"]);
    });

    it("extracts entityId from streamId", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-abc-123",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 50 } }],
      });

      let capturedEntityId = "";
      const projection = defineProjection<OrderEvents>()({
        projectionName: "entity-id-test",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: (_data, ctx) => {
            capturedEntityId = ctx.entityId;
          },
        },
      });

      await store.runProjection(projection);
      expect(capturedEntityId).toBe("abc-123");
    });

    it("skips unknown event types without error", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 100 } },
          { type: "OrderCancelled", data: {} },
        ],
      });

      const handled: string[] = [];
      const projection = defineProjection<OrderEvents>()({
        projectionName: "skip-unknown",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: () => {
            handled.push("OrderPlaced");
          },
          // No handler for OrderCancelled
        },
      });

      await store.runProjection(projection);
      expect(handled).toEqual(["OrderPlaced"]);
    });
  });

  describe("runProjection", () => {
    it("advances checkpoint and does not re-process events", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 100 } }],
      });

      let count = 0;
      const projection = defineProjection<OrderEvents>()({
        projectionName: "checkpoint-test",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: () => {
            count++;
          },
        },
      });

      const processed1 = await store.runProjection(projection);
      expect(processed1).toBe(1);

      const processed2 = await store.runProjection(projection);
      expect(processed2).toBe(0);

      expect(count).toBe(1);
    });

    it("processes new events on subsequent runs", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 100 } }],
      });

      let count = 0;
      const projection = defineProjection<OrderEvents>()({
        projectionName: "incremental-test",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: () => {
            count++;
          },
          OrderShipped: () => {
            count++;
          },
        },
      });

      await store.runProjection(projection);
      expect(count).toBe(1);

      await store.append({
        streamId: "Order-1",
        expectedVersion: 1,
        events: [{ type: "OrderShipped", data: { tracking: "T1" } }],
      });

      await store.runProjection(projection);
      expect(count).toBe(2);
    });

    it("respects batch size", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-1",
        expectedVersion: -1,
        events: [
          { type: "OrderPlaced", data: { total: 1 } },
          { type: "OrderPlaced", data: { total: 2 } },
          { type: "OrderPlaced", data: { total: 3 } },
        ],
      });

      let count = 0;
      const projection = defineProjection<OrderEvents>()({
        projectionName: "batch-test",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: () => {
            count++;
          },
        },
      });

      const processed = await store.runProjection(projection, 2);
      expect(processed).toBe(2);
      expect(count).toBe(2);
    });

    it("provides correct context to handlers", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-xyz",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 99 } }],
      });

      let ctx: Record<string, unknown> = {};
      const projection = defineProjection<OrderEvents>()({
        projectionName: "ctx-test",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: (_data, c) => {
            ctx = {
              entityId: c.entityId,
              streamId: c.streamId,
              streamVersion: c.streamVersion,
            };
          },
        },
      });

      await store.runProjection(projection);
      expect(ctx.entityId).toBe("xyz");
      expect(ctx.streamId).toBe("Order-xyz");
      expect(ctx.streamVersion).toBe(1);
    });

    it("does not skip a lower position that commits after a higher one", async () => {
      // Regression: global_position (BIGSERIAL) is reserved at INSERT but only
      // visible at COMMIT. If a transaction holding a lower position commits
      // *after* one holding a higher position, a naive cursor would advance
      // past the higher position and permanently skip the lower one. The safe
      // watermark must prevent this.
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      const handled: string[] = [];
      const projection = defineProjection<OrderEvents>()({
        projectionName: "late-commit",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: (_data, ctx) => {
            handled.push(ctx.streamId);
          },
        },
      });

      // Transaction A reserves the LOWER position but stays open (uncommitted).
      const txA = await pool.connect();
      try {
        await txA.query("BEGIN");
        await store.append(
          {
            streamId: "Order-low",
            expectedVersion: -1,
            events: [{ type: "OrderPlaced", data: { total: 1 } }],
          },
          { client: txA },
        );

        // Transaction B reserves the HIGHER position and commits first.
        await store.append({
          streamId: "Order-high",
          expectedVersion: -1,
          events: [{ type: "OrderPlaced", data: { total: 2 } }],
        });

        // The projection must NOT advance past the still-in-flight lower
        // position, so nothing is processed yet.
        const processedWhileInFlight = await store.runProjection(projection);
        expect(processedWhileInFlight).toBe(0);
        expect(handled).toEqual([]);

        await txA.query("COMMIT");
      } finally {
        txA.release();
      }

      // Once the lower position commits, both events are processed in order.
      const processedAfterCommit = await store.runProjection(projection);
      expect(processedAfterCommit).toBe(2);
      expect(handled).toEqual(["Order-low", "Order-high"]);
    });

    it("rolls back checkpoint if handler throws", async () => {
      const store = new EventStore({ pool, schema: uniqueSchema() });
      await store.setup();

      await store.append({
        streamId: "Order-err",
        expectedVersion: -1,
        events: [{ type: "OrderPlaced", data: { total: 100 } }],
      });

      const failProjection = defineProjection<OrderEvents>()({
        projectionName: "error-test",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: () => {
            throw new Error("Handler exploded");
          },
        },
      });

      await expect(store.runProjection(failProjection)).rejects.toThrow(
        "Handler exploded",
      );

      // Checkpoint should not have advanced — reprocessing should pick up the event
      let count = 0;
      const retryProjection = defineProjection<OrderEvents>()({
        projectionName: "error-test",
        streamPrefix: "Order",
        handlers: {
          OrderPlaced: () => {
            count++;
          },
        },
      });

      await store.runProjection(retryProjection);
      expect(count).toBe(1);
    });
  });
});
