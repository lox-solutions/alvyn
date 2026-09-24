import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import { EventStore } from "../event-store";
import { defineProjection } from "../projection/define-projection";
import type { StoredEvent } from "../types";
import {
  createTestPool,
  startPostgres,
  stopPostgres,
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

/**
 * Public-API-only schedule: B appends to one stream, A appends to another,
 * B appends again and commits while A is still in flight. Positions are
 * B-first < A < B-last, but B's transaction ID precedes A's. The old tests
 * only cover transactions whose first append is also their only append.
 */
async function withInvertedTransactionOrder(
  store: EventStore,
  run: (input: {
    firstPosition: bigint;
    lowerPosition: bigint;
    higherPosition: bigint;
    commitLower: () => Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const firstAppended = Promise.withResolvers<bigint>();
  const lowerAppended = Promise.withResolvers<bigint>();
  const allowSecondAppend = Promise.withResolvers<void>();
  const allowLowerCommit = Promise.withResolvers<boolean>();

  const olderTransaction = store.withTransaction(async (client) => {
    const first = await store.append(
      {
        streamId: "Order-first",
        expectedVersion: -1,
        events: [{ type: "Placed", data: { label: "first" } }],
      },
      { client },
    );
    firstAppended.resolve(first.globalPositions[0]);
    await allowSecondAppend.promise;
    return store.append(
      {
        streamId: "Order-high",
        expectedVersion: -1,
        events: [{ type: "Placed", data: { label: "high" } }],
      },
      { client },
    );
  });
  // Forward early append failures to the corresponding synchronization point.
  void olderTransaction.catch((error: unknown) => firstAppended.reject(error));
  let youngerTransaction: Promise<void> | undefined;
  try {
    const firstPosition = await firstAppended.promise;
    youngerTransaction = store.withTransaction(async (client) => {
      const low = await store.append(
        {
          streamId: "Order-low",
          expectedVersion: -1,
          events: [{ type: "Placed", data: { label: "low" } }],
        },
        { client },
      );
      lowerAppended.resolve(low.globalPositions[0]);
      if (!(await allowLowerCommit.promise)) {
        throw new Error("Cancel the unfinished lower-position transaction");
      }
    });
    void youngerTransaction.catch((error: unknown) =>
      lowerAppended.reject(error),
    );
    const lowerPosition = await lowerAppended.promise;
    allowSecondAppend.resolve();
    const high = await olderTransaction; // B has committed; A is still open.
    const higherPosition = high.globalPositions[0];
    expect(firstPosition).toBeLessThan(lowerPosition);
    expect(lowerPosition).toBeLessThan(higherPosition);

    await run({
      firstPosition,
      lowerPosition,
      higherPosition,
      commitLower: async () => {
        allowLowerCommit.resolve(true);
        await youngerTransaction;
      },
    });
  } finally {
    allowSecondAppend.resolve();
    allowLowerCommit.resolve(false);
    await Promise.allSettled(
      youngerTransaction
        ? [olderTransaction, youngerTransaction]
        : [olderTransaction],
    );
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("commit order differs from transaction-id and global-position order", () => {
  it("projection must not checkpoint past a lower in-flight position", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();
    const seen: bigint[] = [];
    const projection = defineProjection<{ Placed: { label: string } }>()({
      projectionName: "inverted-transaction-ids",
      streamPrefix: "Order",
      handlers: {
        Placed: (_data, ctx) => {
          seen.push(ctx.globalPosition);
        },
      },
    });

    await withInvertedTransactionOrder(
      store,
      async ({ firstPosition, lowerPosition, higherPosition, commitLower }) => {
        // Position 1 is safe, but position 3 must not pass the in-flight 2.
        const beforeLowerCommit = await store.runProjection(projection);
        const prematurelyProcessed = seen.filter(
          (position) => position >= lowerPosition,
        );
        await commitLower();
        const afterLowerCommit = await store.runProjection(projection);
        expect({
          prematurelyProcessed,
          processed: beforeLowerCommit + afterLowerCommit,
          seen,
        }).toEqual({
          prematurelyProcessed: [],
          processed: 3,
          seen: [firstPosition, lowerPosition, higherPosition],
        });
      },
    );
  });

  it("subscription must not emit a higher position before a lower in-flight one", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await withInvertedTransactionOrder(
      store,
      async ({ firstPosition, lowerPosition, higherPosition, commitLower }) => {
        const controller = new AbortController();
        const seen: StoredEvent[] = [];
        const subscriber = (async () => {
          for await (const event of store.subscribe({
            pollIntervalMs: 20,
            signal: controller.signal,
          })) {
            seen.push(event);
            if (seen.length === 3) break;
          }
        })();
        try {
          // Let catch-up run while the lower position is still uncommitted.
          await sleep(250);
          const beforeLowerCommit = seen.map((e) => e.globalPosition);
          await commitLower();
          // Bound the wait: a skipped event must fail, not hang the test suite.
          const deadline = Date.now() + 2_000;
          while (seen.length < 3 && Date.now() < deadline) await sleep(20);
          expect({
            prematurelyReceived: beforeLowerCommit.filter(
              (position) => position >= lowerPosition,
            ),
            eventuallyReceived: seen.map((e) => e.globalPosition),
          }).toEqual({
            prematurelyReceived: [],
            eventuallyReceived: [firstPosition, lowerPosition, higherPosition],
          });
        } finally {
          controller.abort();
          await subscriber;
        }
      },
    );
  });
});
