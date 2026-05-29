import { describe, it, expect, vi } from "vitest";
import { defineProjection } from "./define-projection";
import type { StoredEvent } from "../types";
import type { PoolClient } from "pg";

type TestEvents = {
  OrderPlaced: { total: number };
  OrderShipped: { tracking: string };
};

function fakeEvent(overrides: Partial<StoredEvent>): StoredEvent {
  return {
    globalPosition: 1n,
    streamId: "Order-123",
    streamVersion: 1,
    type: "OrderPlaced",
    data: { total: 100 },
    createdAt: new Date(),
    extensions: {},
    schemaVersion: 1,
    ...overrides,
  } as StoredEvent;
}

const fakeClient = {} as PoolClient;

describe("defineProjection (unit)", () => {
  it("exposes projectionName and streamPrefix", () => {
    const proj = defineProjection<TestEvents>()({
      projectionName: "test",
      streamPrefix: "Order",
      handlers: {},
    });

    expect(proj.projectionName).toBe("test");
    expect(proj.streamPrefix).toBe("Order");
  });

  it("dispatches to correct handler with data and context", async () => {
    const handler = vi.fn();
    const proj = defineProjection<TestEvents>()({
      projectionName: "dispatch-test",
      streamPrefix: "Order",
      handlers: { OrderPlaced: handler },
    });

    const event = fakeEvent({
      streamId: "Order-abc",
      type: "OrderPlaced",
      data: { total: 42 },
      streamVersion: 3,
      globalPosition: 7n,
    });

    await proj.handle(event, fakeClient);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toEqual({ total: 42 });
    const ctx = handler.mock.calls[0]?.[1] as {
      entityId: string;
      streamId: string;
      streamVersion: number;
      globalPosition: bigint;
      client: PoolClient;
    };
    expect(ctx.entityId).toBe("abc");
    expect(ctx.streamId).toBe("Order-abc");
    expect(ctx.streamVersion).toBe(3);
    expect(ctx.globalPosition).toBe(7n);
    expect(ctx.client).toBe(fakeClient);
  });

  it("skips events from different stream prefix", async () => {
    const handler = vi.fn();
    const proj = defineProjection<TestEvents>()({
      projectionName: "filter-test",
      streamPrefix: "Order",
      handlers: { OrderPlaced: handler },
    });

    await proj.handle(fakeEvent({ streamId: "User-1" }), fakeClient);
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips events with no matching handler", async () => {
    const proj = defineProjection<TestEvents>()({
      projectionName: "no-handler",
      streamPrefix: "Order",
      handlers: {
        // Only OrderPlaced, not OrderShipped
        OrderPlaced: vi.fn(),
      },
    });

    // Should not throw for unhandled event type
    await expect(
      proj.handle(fakeEvent({ type: "OrderShipped" }), fakeClient),
    ).resolves.toBeUndefined();
  });

  it("extracts entity ID after prefix-dash correctly", async () => {
    const handler = vi.fn();
    const proj = defineProjection<TestEvents>()({
      projectionName: "entity-id",
      streamPrefix: "Order",
      handlers: { OrderPlaced: handler },
    });

    // Multi-segment entity ID
    await proj.handle(fakeEvent({ streamId: "Order-abc-def-ghi" }), fakeClient);

    expect((handler.mock.calls[0]?.[1] as { entityId: string }).entityId).toBe(
      "abc-def-ghi",
    );
  });
});
