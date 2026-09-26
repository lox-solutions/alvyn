import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import { EventStore } from "../event-store";
import type { Projection, StoredEvent } from "../types";
import type { SubscribeOptions } from "../subscription/subscribe-options";
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

class IntentionalRollbackError extends Error {}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function newStore(): Promise<EventStore> {
  const store = new EventStore({ pool, schema: uniqueSchema() });
  await store.setup();
  return store;
}

async function append(
  store: EventStore,
  streamId: string,
  count = 1,
): Promise<bigint[]> {
  return (
    await store.append({
      streamId,
      expectedVersion: -1,
      events: Array.from({ length: count }, (_, i) => ({
        type: "Placed",
        data: { index: i },
      })),
    })
  ).globalPositions;
}

type Held = {
  positions: bigint[];
  finish(commit: boolean): Promise<void>;
};

/** Hold an Alvyn append transaction open without manually issuing SQL. */
async function holdAppend(options: {
  store: EventStore;
  streamId: string;
  count?: number;
}): Promise<Held> {
  const { store, streamId, count = 1 } = options;
  const ready = Promise.withResolvers<bigint[]>();
  const gate = Promise.withResolvers<boolean>();
  const transaction = store.withTransaction(async (client) => {
    const result = await store.append(
      {
        streamId,
        expectedVersion: -1,
        events: Array.from({ length: count }, (_, i) => ({
          type: "Placed",
          data: { index: i },
        })),
      },
      { client },
    );
    ready.resolve(result.globalPositions);
    if (!(await gate.promise))
      throw new IntentionalRollbackError("deliberate rollback");
  });
  void transaction.catch((error: unknown) => ready.reject(error));
  try {
    const positions = await ready.promise;
    let finished = false;
    return {
      positions,
      async finish(commit: boolean) {
        if (finished) return;
        finished = true;
        gate.resolve(commit);
        if (commit) await transaction;
        else
          await expect(transaction).rejects.toBeInstanceOf(
            IntentionalRollbackError,
          );
      },
    };
  } catch (error) {
    gate.resolve(false);
    await Promise.allSettled([transaction]);
    throw error;
  }
}

type HeldDouble = {
  first: bigint[];
  finishSecond(): Promise<bigint[]>;
  cancel(): Promise<void>;
};

/** First and last appends are in the same transaction, with a barrier in between. */
async function holdTwoAppends(options: {
  store: EventStore;
  firstStream: string;
  lastStream: string;
  firstCount?: number;
  lastCount?: number;
}): Promise<HeldDouble> {
  const {
    store,
    firstStream,
    lastStream,
    firstCount = 1,
    lastCount = 1,
  } = options;
  const ready = Promise.withResolvers<bigint[]>();
  const gate = Promise.withResolvers<boolean>();
  const transaction = store.withTransaction(async (client) => {
    const first = await store.append(
      {
        streamId: firstStream,
        expectedVersion: -1,
        events: Array.from({ length: firstCount }, (_, i) => ({
          type: "Placed",
          data: { index: i },
        })),
      },
      { client },
    );
    ready.resolve(first.globalPositions);
    if (!(await gate.promise))
      throw new IntentionalRollbackError("deliberate rollback");
    return (
      await store.append(
        {
          streamId: lastStream,
          expectedVersion: -1,
          events: Array.from({ length: lastCount }, (_, i) => ({
            type: "Placed",
            data: { index: i },
          })),
        },
        { client },
      )
    ).globalPositions;
  });
  void transaction.catch((error: unknown) => ready.reject(error));
  try {
    const first = await ready.promise;
    let finished = false;
    return {
      first,
      async finishSecond() {
        if (finished) throw new Error("Transaction already finished");
        finished = true;
        gate.resolve(true);
        return transaction;
      },
      async cancel() {
        if (finished) return;
        finished = true;
        gate.resolve(false);
        await expect(transaction).rejects.toBeInstanceOf(
          IntentionalRollbackError,
        );
      },
    };
  } catch (error) {
    gate.resolve(false);
    await Promise.allSettled([transaction]);
    throw error;
  }
}

function watch(store: EventStore, options: SubscribeOptions, count: number) {
  const controller = new AbortController();
  const seen: StoredEvent[] = [];
  const done = (async () => {
    for await (const event of store.subscribe({
      pollIntervalMs: 10,
      ...options,
      signal: controller.signal,
    })) {
      seen.push(event);
      if (seen.length === count) break;
    }
  })();
  return {
    seen,
    done,
    async close() {
      controller.abort();
      await done;
    },
  };
}

async function waitForCount(
  events: StoredEvent[],
  count: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (events.length < count && Date.now() < deadline) await pause(10);
}

async function drain(
  store: EventStore,
  projection: Projection,
  batchSize = 7,
): Promise<number> {
  let total = 0;
  let count: number;
  do {
    count = await store.runProjection(projection, batchSize);
    total += count;
  } while (count === batchSize);
  return total;
}

function recordingProjection(seen: bigint[]): Projection {
  return {
    projectionName: "cursor-interleaving",
    handle(event) {
      seen.push(event.globalPosition);
      return Promise.resolve();
    },
  };
}

interface StressRoundOptions {
  store: EventStore;
  projection: Projection;
  expected: bigint[];
  round: number;
  random: () => number;
}

/** A younger transaction's sole append precedes a newer committed append. */
async function stressWithEarlierMiddle(
  options: StressRoundOptions,
): Promise<void> {
  const { store, projection, expected, round, random } = options;
  const middle = await holdAppend({ store, streamId: `Order-middle-${round}` });
  try {
    const last = await append(store, `Order-last-${round}`, 1 + (random() % 2));
    expected.push(...last);
    await drain(store, projection);
    const commit = random() % 4 !== 0;
    await middle.finish(commit);
    if (commit) expected.push(...middle.positions);
    await drain(store, projection);
  } finally {
    await middle.finish(false);
  }
}

async function processStressOverlap(options: {
  scenario: StressRoundOptions;
  older: HeldDouble;
  middle: Held;
  pattern: number;
}): Promise<void> {
  const { scenario, older, middle, pattern } = options;
  const { store, projection, expected, random } = scenario;
  const commitMiddle = random() % 4 !== 0;
  if (pattern === 1) {
    // Middle commits before the older transaction's second append.
    await middle.finish(commitMiddle);
    if (commitMiddle) expected.push(...middle.positions);
  }
  if (pattern === 2) {
    // Roll back the older transaction, leaving multiple sequence gaps.
    await older.cancel();
  } else {
    const last = await older.finishSecond();
    expected.push(...older.first, ...last);
  }
  await drain(store, projection);
  await pause(12);
  if (pattern !== 1) {
    await middle.finish(commitMiddle);
    if (commitMiddle) expected.push(...middle.positions);
  }
  await drain(store, projection);
}

/** Transaction IDs precede event positions in a different order. */
async function stressWithOlderWriter(
  options: StressRoundOptions,
  pattern: number,
): Promise<void> {
  const { store, round, random } = options;
  const older = await holdTwoAppends({
    store,
    firstStream: `Order-first-${round}`,
    lastStream: `Order-last-${round}`,
    firstCount: 1 + (random() % 3),
    lastCount: 1 + (random() % 2),
  });
  try {
    const middle = await holdAppend({
      store,
      streamId: `Order-middle-${round}`,
      count: 1 + (random() % 2),
    });
    try {
      await processStressOverlap({ scenario: options, older, middle, pattern });
    } finally {
      await middle.finish(false);
    }
  } finally {
    await older.cancel();
  }
}

async function stressRound(options: StressRoundOptions): Promise<void> {
  const pattern = options.random() % 4;
  if (pattern === 3) await stressWithEarlierMiddle(options);
  else await stressWithOlderWriter(options, pattern);
  options.expected.push(
    ...(await append(options.store, `Order-standalone-${options.round}`)),
  );
}

async function assertThreeWriterDelivery(options: {
  store: EventStore;
  middle: Held;
  expected: bigint[];
}): Promise<void> {
  const { store, middle, expected } = options;
  const seen: bigint[] = [];
  const subscriber = watch(store, { batchSize: 2 }, expected.length);
  try {
    await drain(store, recordingProjection(seen));
    await pause(150);
    const premature = seen.filter((position) => position > middle.positions[0]);
    const prematureSubscription = subscriber.seen
      .map((event) => event.globalPosition)
      .filter((position) => position > middle.positions[0]);
    await middle.finish(true);
    await drain(store, recordingProjection(seen));
    await waitForCount(subscriber.seen, expected.length);
    expect({
      premature,
      prematureSubscription,
      seen,
      received: subscriber.seen.map((event) => event.globalPosition),
    }).toEqual({
      premature: [],
      prematureSubscription: [],
      seen: expected,
      received: expected,
    });
  } finally {
    await subscriber.close();
  }
}

describe("cursor safety across application writers", () => {
  it("does not pass a middle position until its rollback is known (projection)", async () => {
    const store = await newStore();
    const first = await holdTwoAppends({
      store,
      firstStream: "Order-before",
      lastStream: "Order-after",
    });
    try {
      const middle = await holdAppend({ store, streamId: "Order-rollback" });
      try {
        const last = await first.finishSecond();
        const seen: bigint[] = [];
        const projection = recordingProjection(seen);
        await drain(store, projection);
        const premature = seen.filter(
          (position) => position > middle.positions[0],
        );
        await middle.finish(false);
        await drain(store, projection);
        expect({ premature, seen }).toEqual({
          premature: [],
          seen: [first.first[0], last[0]],
        });
      } finally {
        await middle.finish(false);
      }
    } finally {
      await first.cancel();
    }
  });

  it("does not send past a middle position before rollback (subscription)", async () => {
    const store = await newStore();
    const first = await holdTwoAppends({
      store,
      firstStream: "Order-before",
      lastStream: "Order-after",
    });
    try {
      const middle = await holdAppend({ store, streamId: "Order-rollback" });
      try {
        const last = await first.finishSecond();
        const subscriber = watch(store, {}, 2);
        try {
          await pause(150);
          const premature = subscriber.seen.filter(
            (event) => event.globalPosition > middle.positions[0],
          );
          await middle.finish(false);
          await waitForCount(subscriber.seen, 2);
          expect({
            premature: premature.map((e) => e.globalPosition),
            seen: subscriber.seen.map((e) => e.globalPosition),
          }).toEqual({
            premature: [],
            seen: [first.first[0], last[0]],
          });
        } finally {
          await subscriber.close();
        }
      } finally {
        await middle.finish(false);
      }
    } finally {
      await first.cancel();
    }
  });

  it("keeps the cursor behind an open middle transaction with three concurrent writers", async () => {
    const store = await newStore();
    const b = await holdTwoAppends({
      store,
      firstStream: "Order-b-first",
      lastStream: "Order-b-last",
    });
    try {
      const c = await holdTwoAppends({
        store,
        firstStream: "Order-c-first",
        lastStream: "Order-c-last",
      });
      try {
        const a = await holdAppend({ store, streamId: "Order-middle" });
        try {
          const cLast = await c.finishSecond();
          const bLast = await b.finishSecond();
          await assertThreeWriterDelivery({
            store,
            middle: a,
            expected: [
              b.first[0],
              c.first[0],
              a.positions[0],
              cLast[0],
              bLast[0],
            ],
          });
        } finally {
          await a.finish(false);
        }
      } finally {
        await c.cancel();
      }
    } finally {
      await b.cancel();
    }
  });

  it("unblocks committed events when an earlier transaction rolls back", async () => {
    const store = await newStore();
    const blocker = await holdAppend({ store, streamId: "Order-blocker" });
    try {
      const later = await append(store, "Order-later");
      const seen: bigint[] = [];
      const projection = recordingProjection(seen);
      const subscriber = watch(store, {}, 1);
      try {
        expect(await drain(store, projection)).toBe(0);
        await pause(150);
        expect(subscriber.seen).toEqual([]);
        await blocker.finish(false);
        await drain(store, projection);
        await waitForCount(subscriber.seen, 1);
        expect(seen).toEqual(later);
        expect(subscriber.seen.map((event) => event.globalPosition)).toEqual(
          later,
        );
      } finally {
        await subscriber.close();
      }
    } finally {
      await blocker.finish(false);
    }
  });

  it("resumes a filtered GraphQL-style subscription without losing a late commit", async () => {
    const store = await newStore();
    const baseline = await append(store, "Order-baseline");
    const initial = watch(
      store,
      { subject: "Order-", recursive: true, eventTypes: ["Placed"] },
      1,
    );
    try {
      await waitForCount(initial.seen, 1);
      expect(initial.seen.map((e) => e.globalPosition)).toEqual(baseline);
    } finally {
      await initial.close();
    }

    const first = await holdTwoAppends({
      store,
      firstStream: "Other-unrelated",
      lastStream: "Order-later",
    });
    try {
      const middle = await holdAppend({ store, streamId: "Order-middle" });
      try {
        const last = await first.finishSecond();
        const resumed = watch(
          store,
          {
            subject: "Order-",
            recursive: true,
            eventTypes: ["Placed"],
            lowerBound: { id: baseline[0].toString(), type: "exclusive" },
            batchSize: 1,
          },
          2,
        );
        try {
          await pause(150);
          const premature = resumed.seen.filter(
            (event) => event.globalPosition > middle.positions[0],
          );
          await middle.finish(true);
          await waitForCount(resumed.seen, 2);
          expect({
            premature: premature.map((e) => e.globalPosition),
            received: resumed.seen.map((e) => e.globalPosition),
          }).toEqual({
            premature: [],
            received: [middle.positions[0], last[0]],
          });
        } finally {
          await resumed.close();
        }
      } finally {
        await middle.finish(false);
      }
    } finally {
      await first.cancel();
    }
  });

  it("serializes same-stream writers via Alvyn's stream lock", async () => {
    const store = await newStore();
    const first = await holdAppend({ store, streamId: "Order-shared" });
    try {
      let secondFinished = false;
      const second = store
        .append({
          streamId: "Order-shared",
          expectedVersion: 1,
          events: [{ type: "Placed", data: { index: 1 } }],
        })
        .then((result) => {
          secondFinished = true;
          return result.globalPositions;
        });
      await pause(60);
      const finishedWhileLocked = secondFinished;
      await first.finish(true);
      const later = await second;
      const seen: bigint[] = [];
      await drain(store, recordingProjection(seen));
      expect({ finishedWhileLocked, seen }).toEqual({
        finishedWhileLocked: false,
        seen: [first.positions[0], later[0]],
      });
    } finally {
      await first.finish(false);
    }
  });

  it("coordinates competing projection runners through their shared checkpoint", async () => {
    const schema = uniqueSchema();
    const writers = new EventStore({ pool, schema });
    await writers.setup();
    const events = await append(writers, "Order-batch", 13);
    const replicas = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const store = new EventStore({ pool, schema });
        await store.setup();
        return store;
      }),
    );
    const seen: bigint[] = [];
    const projection: Projection = {
      projectionName: "same-checkpoint-multiple-replicas",
      async handle(event) {
        await pause(5);
        seen.push(event.globalPosition);
      },
    };
    const firstRound = await Promise.all(
      replicas.map((replica) => replica.runProjection(projection, 3)),
    );
    const catchup = await drain(replicas[0], projection, 3);
    expect({
      count: firstRound.reduce((sum, count) => sum + count, 0) + catchup,
      seen,
    }).toEqual({ count: events.length, seen: events });
  });

  it("resumes the persisted projection checkpoint on another application instance", async () => {
    const schema = uniqueSchema();
    const writer = new EventStore({ pool, schema });
    await writer.setup();
    const first = await holdTwoAppends({
      store: writer,
      firstStream: "Order-first",
      lastStream: "Order-last",
    });
    try {
      const middle = await holdAppend({
        store: writer,
        streamId: "Order-middle",
      });
      try {
        const last = await first.finishSecond();
        const seen: bigint[] = [];
        const projection = recordingProjection(seen);
        const before = await writer.runProjection(projection);
        await middle.finish(true);
        // Setup executes DDL; it must not run while another writer keeps the
        // same events table locked by an unfinished transaction.
        const newInstance = new EventStore({ pool, schema });
        await newInstance.setup();
        const after = await newInstance.runProjection(projection);
        expect({ processed: before + after, seen }).toEqual({
          processed: 3,
          seen: [first.first[0], middle.positions[0], last[0]],
        });
      } finally {
        await middle.finish(false);
      }
    } finally {
      await first.cancel();
    }
  });

  it("rolls back PostgreSQL read-model writes and the checkpoint together on handler failure", async () => {
    const schema = uniqueSchema();
    const store = new EventStore({ pool, schema });
    await store.setup();
    await pool.query(
      `CREATE TABLE ${schema}.read_model (global_position bigint PRIMARY KEY)`,
    );
    const positions = await append(store, "Order-batch", 3);
    const projectionName = "transactional-read-model";
    const failing: Projection = {
      projectionName,
      async handle(event, client) {
        await client.query(`INSERT INTO ${schema}.read_model VALUES ($1)`, [
          event.globalPosition.toString(),
        ]);
        if (event.globalPosition === positions[1])
          throw new Error("handler failed");
      },
    };
    await expect(store.runProjection(failing)).rejects.toThrow(
      "handler failed",
    );
    const afterFailure = await pool.query<{ global_position: string }>(
      `SELECT global_position::text FROM ${schema}.read_model ORDER BY global_position`,
    );
    expect(afterFailure.rows).toEqual([]);
    const retry: Projection = {
      projectionName,
      async handle(event, client) {
        await client.query(`INSERT INTO ${schema}.read_model VALUES ($1)`, [
          event.globalPosition.toString(),
        ]);
      },
    };
    const restarted = new EventStore({ pool, schema });
    await restarted.setup();
    expect(await restarted.runProjection(retry)).toBe(positions.length);
    expect(await restarted.runProjection(retry)).toBe(0);
    const afterRetry = await pool.query<{ global_position: string }>(
      `SELECT global_position::text FROM ${schema}.read_model ORDER BY global_position`,
    );
    expect(afterRetry.rows.map((row) => BigInt(row.global_position))).toEqual(
      positions,
    );
  });

  it("seeded stress: catches every committed event across appends, rollbacks and batches", async () => {
    const store = await newStore();
    const projected: bigint[] = [];
    const projection = recordingProjection(projected);
    const subscriber = watch(store, { batchSize: 3 }, Infinity);
    const expected: bigint[] = [];
    let seed = 0x5eed;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    try {
      const rounds = Number(process.env.ALVYN_CURSOR_STRESS_ROUNDS ?? 24);
      expect(Number.isSafeInteger(rounds) && rounds > 0).toBe(true);
      for (let round = 0; round < rounds; round++) {
        await stressRound({ store, projection, expected, round, random });
      }
      await drain(store, projection);
      await waitForCount(subscriber.seen, expected.length);
      const sorted = expected.sort((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
      const subscribed = subscriber.seen.map((e) => e.globalPosition);
      expect({
        seed: "0x5eed",
        expectedCount: sorted.length,
        projectionCount: projected.length,
        subscriptionCount: subscribed.length,
        missingProjection: sorted.filter(
          (position) => !projected.includes(position),
        ),
        missingSubscription: sorted.filter(
          (position) => !subscribed.includes(position),
        ),
        projectionOrderedAndUnique: projected.every(
          (position, i) => i === 0 || position > projected[i - 1],
        ),
        subscriptionOrderedAndUnique: subscribed.every(
          (position, i) => i === 0 || position > subscribed[i - 1],
        ),
      }).toEqual({
        seed: "0x5eed",
        expectedCount: sorted.length,
        projectionCount: sorted.length,
        subscriptionCount: sorted.length,
        missingProjection: [],
        missingSubscription: [],
        projectionOrderedAndUnique: true,
        subscriptionOrderedAndUnique: true,
      });
    } finally {
      await subscriber.close();
    }
  });
});
