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
          OrderPlaced: async (_data, ctx) => {
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
          OrderPlaced: async (_data, ctx) => {
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
          OrderPlaced: async () => {
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
          OrderPlaced: async () => {
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
          OrderPlaced: async () => {
            count++;
          },
          OrderShipped: async () => {
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
          OrderPlaced: async () => {
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
          OrderPlaced: async (_data, c) => {
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
          OrderPlaced: async () => {
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
          OrderPlaced: async () => { count++; },
        },
      });

      await store.runProjection(retryProjection);
      expect(count).toBe(1);
    });
  });
});
