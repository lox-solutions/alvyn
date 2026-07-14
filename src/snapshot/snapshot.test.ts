import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { EventStore } from "../event-store";
import { ReservedSnapshotEventTypeError } from "../errors";
import {
  createTestPool,
  startPostgres,
  stopPostgres,
  uniqueSchema,
} from "../__tests__/setup";
import { defineSnapshot } from "./define-snapshot";

let pool: pg.Pool;

beforeAll(async () => {
  await startPostgres();
  pool = createTestPool();
});

afterAll(async () => {
  await pool.end();
  await stopPostgres();
});

type TransactionEvents = {
  Deposit: { amount: number };
  Withdrawal: { amount: number };
  NoteAdded: { note: string };
};

const BankAccountBalance = defineSnapshot<
  { balance: number },
  TransactionEvents
>()({
  streamPrefix: "Transaction",
  snapshotName: "BankAccountBalance",
  every: 100,
  initialState: { balance: 0 },
  evolve: {
    Deposit: (state, event) => ({
      balance: state.balance + (event.data?.amount ?? 0),
    }),
    Withdrawal: (state, event) => ({
      balance: state.balance - (event.data?.amount ?? 0),
    }),
  },
});

const FrequentlySnapshottedBalance = defineSnapshot<
  { balance: number },
  TransactionEvents
>()({
  streamPrefix: "Transaction",
  snapshotName: "FrequentBankAccountBalance",
  every: 2,
  initialState: { balance: 0 },
  evolve: {
    Deposit: (state, event) => ({
      balance: state.balance + (event.data?.amount ?? 0),
    }),
    Withdrawal: (state, event) => ({
      balance: state.balance - (event.data?.amount ?? 0),
    }),
  },
});

describe("defineSnapshot", () => {
  it("exposes snapshot metadata", () => {
    expect(BankAccountBalance.streamPrefix).toBe("Transaction");
    expect(BankAccountBalance.snapshotName).toBe("BankAccountBalance");
    expect(BankAccountBalance.snapshotEventType).toBe(
      "BankAccountBalanceSnapshot",
    );
  });

  it("returns initial state for an empty stream", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    const result = await BankAccountBalance.load(store, "empty");

    expect(result).toEqual({
      state: { balance: 0 },
      streamId: "Transaction-empty",
      version: 0,
      snapshotVersion: null,
      replayedEvents: 0,
    });
  });

  it("derives state from source events without an existing snapshot", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.append({
      streamId: "Transaction-source-events",
      expectedVersion: -1,
      events: [
        { type: "Deposit", data: { amount: 100 } },
        { type: "NoteAdded", data: { note: "ignored" } },
        { type: "Withdrawal", data: { amount: 25 } },
      ],
    });

    const result = await BankAccountBalance.load(store, "source-events");

    expect(result.state).toEqual({ balance: 75 });
    expect(result.version).toBe(3);
    expect(result.snapshotVersion).toBeNull();
    expect(result.replayedEvents).toBe(2);
  });

  it("loads from the latest snapshot event and replays only later source events", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.appendSnapshot({
      streamId: "Transaction-existing-snapshot",
      expectedVersion: -1,
      events: [{ type: "BankAccountBalanceSnapshot", data: { balance: 100 } }],
    });
    await store.append({
      streamId: "Transaction-existing-snapshot",
      expectedVersion: 1,
      events: [
        { type: "Withdrawal", data: { amount: 30 } },
        { type: "Deposit", data: { amount: 10 } },
      ],
    });

    const result = await BankAccountBalance.load(store, "existing-snapshot");

    expect(result.state).toEqual({ balance: 80 });
    expect(result.version).toBe(3);
    expect(result.snapshotVersion).toBe(1);
    expect(result.replayedEvents).toBe(2);
  });

  it("rejects user-supplied event types ending in Snapshot", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await expect(
      store.append({
        streamId: "Transaction-reserved-name",
        expectedVersion: -1,
        events: [{ type: "CustomSnapshot", data: { balance: 100 } }],
      }),
    ).rejects.toThrow(ReservedSnapshotEventTypeError);
  });

  it("does not append snapshots during load when the store has no registered snapshots", async () => {
    const store = new EventStore({ pool, schema: uniqueSchema() });
    await store.setup();

    await store.append({
      streamId: "Transaction-unregistered-snapshot",
      expectedVersion: -1,
      events: [
        { type: "Deposit", data: { amount: 100 } },
        { type: "Withdrawal", data: { amount: 20 } },
      ],
    });

    const result = await FrequentlySnapshottedBalance.load(
      store,
      "unregistered-snapshot",
    );
    const events = await store.load("Transaction-unregistered-snapshot");

    expect(result.state).toEqual({ balance: 80 });
    expect(result.version).toBe(2);
    expect(result.snapshotVersion).toBeNull();
    expect(result.replayedEvents).toBe(2);
    expect(events.map((event) => event.type)).toEqual([
      "Deposit",
      "Withdrawal",
    ]);
  });

  it("appends registered snapshot events when incoming events reach the threshold", async () => {
    const store = new EventStore({
      pool,
      schema: uniqueSchema(),
      snapshots: [FrequentlySnapshottedBalance],
    });
    await store.setup();

    const appendResult = await store.append({
      streamId: "Transaction-write-time-snapshot",
      expectedVersion: -1,
      events: [
        { type: "Deposit", data: { amount: 100 } },
        { type: "Withdrawal", data: { amount: 20 } },
      ],
    });
    const events = await store.load("Transaction-write-time-snapshot");
    const balance = await FrequentlySnapshottedBalance.load(
      store,
      "write-time-snapshot",
    );

    expect(appendResult).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect(events.map((event) => event.type)).toEqual([
      "Deposit",
      "Withdrawal",
      "FrequentBankAccountBalanceSnapshot",
    ]);
    expect(balance).toMatchObject({
      state: { balance: 80 },
      version: 3,
      snapshotVersion: 3,
      replayedEvents: 0,
    });
  });
});
