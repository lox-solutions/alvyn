import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "../event-store";
import { computeSafeWatermark } from "./compute-safe-watermark";
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

async function watermark(schema: string): Promise<bigint> {
  const client = await pool.connect();
  try {
    return await computeSafeWatermark({ client, schema });
  } finally {
    client.release();
  }
}

describe("computeSafeWatermark", () => {
  it("returns 0 for an empty events table", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    expect(await watermark(schema)).toBe(0n);
  });

  it("includes positions of committed transactions", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    const result = await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [
        { type: "OrderPlaced", data: { total: 1 } },
        { type: "OrderShipped", data: { tracking: "T1" } },
      ],
    });

    const maxPosition =
      result.globalPositions[result.globalPositions.length - 1];
    expect(await watermark(schema)).toBe(maxPosition);
  });

  it("excludes positions of still-running transactions and includes them once committed", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    // First committed event establishes a baseline position.
    const first = await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 1 } }],
    });
    const firstPos = first.globalPositions[0];
    expect(await watermark(schema)).toBe(firstPos);

    // Open a long-running transaction that appends but does not yet commit.
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await store.append(
        {
          streamId: "Order-2",
          expectedVersion: -1,
          events: [{ type: "OrderPlaced", data: { total: 2 } }],
        },
        { client: tx },
      );

      // From another connection the in-flight position must be excluded.
      expect(await watermark(schema)).toBe(firstPos);

      await tx.query("COMMIT");
    } finally {
      tx.release();
    }

    // After commit, the watermark advances to include the new position.
    expect(await watermark(schema)).toBe(firstPos + 1n);
  });

  it("does not stall on gaps left by aborted transactions", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();

    const first = await store.append({
      streamId: "Order-1",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 1 } }],
    });
    const firstPos = first.globalPositions[0];

    // Reserve a position then roll back, leaving a permanent gap.
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await store.append(
        {
          streamId: "Order-2",
          expectedVersion: -1,
          events: [{ type: "OrderPlaced", data: { total: 2 } }],
        },
        { client: tx },
      );
      await tx.query("ROLLBACK");
    } finally {
      tx.release();
    }

    // A later committed event lands beyond the aborted gap.
    const next = await store.append({
      streamId: "Order-3",
      expectedVersion: -1,
      events: [{ type: "OrderPlaced", data: { total: 3 } }],
    });
    const nextPos = next.globalPositions[0];
    expect(nextPos).toBeGreaterThan(firstPos + 1n);

    // The watermark advances past the permanent gap to the latest committed position.
    expect(await watermark(schema)).toBe(nextPos);
  });
});
