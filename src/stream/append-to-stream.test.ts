import { describe, expect, it, vi } from "vitest";

import { appendToStream } from "./append-to-stream";
import { computeRequestHash } from "./idempotency";

interface ExistingIdempotencyKey {
  stream_id: string;
  request_hash: string;
  from_version: number;
  to_version: number;
  global_positions: string[];
}

/** Return answers by SQL purpose, not by the number of preceding queries. */
function createQuery(existing?: ExistingIdempotencyKey) {
  return vi.fn((sql: string, params?: unknown[]) => {
    if (sql.includes("FROM event_store.idempotency_keys")) {
      expect(params).toHaveLength(1);
      return Promise.resolve({ rows: existing ? [existing] : [] });
    }
    if (sql.includes("MAX(stream_version)")) {
      return Promise.resolve({ rows: [{ max_version: null }] });
    }
    if (sql.includes("INSERT INTO event_store.events")) {
      return Promise.resolve({ rows: [{ global_position: "1" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function expectNoAppendSideEffects(
  query: ReturnType<typeof createQuery>,
  streamId: string,
  idempotencyKey: string,
): void {
  const calls = query.mock.calls;
  const lockIndex = calls.findIndex(([sql]) =>
    sql.includes("pg_advisory_xact_lock(hashtextextended("),
  );
  const lookupIndex = calls.findIndex(([sql]) =>
    sql.includes("FROM event_store.idempotency_keys"),
  );
  expect(lockIndex).toBeGreaterThanOrEqual(0);
  expect(lookupIndex).toBeGreaterThan(lockIndex);
  expect(calls[lockIndex]?.[1]).toEqual([streamId]);
  expect(calls[lookupIndex]?.[1]).toEqual([idempotencyKey]);

  for (const [sql] of calls) {
    expect(sql).not.toMatch(/MAX\(stream_version\)/);
    expect(sql).not.toMatch(
      /\bINSERT\s+INTO\s+event_store\.(events|outbox|idempotency_keys)\b/i,
    );
    expect(sql).not.toMatch(/\bpg_notify\s*\(/i);
  }
}

describe("appendToStream", () => {
  it("locks the stream before checking its version and inserting events", async () => {
    const query = createQuery();

    const result = await appendToStream({
      client: { query } as never,
      schema: "event_store",
      input: {
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "Created", data: { total: 100 } }],
      },
      cryptoKeyManager: null,
    });

    const sql = query.mock.calls.map(([statement]) => statement);
    const lockIndex = sql.findIndex((statement) =>
      statement.includes("pg_advisory_xact_lock(hashtextextended("),
    );
    const versionIndex = sql.findIndex((statement) =>
      statement.includes("MAX(stream_version)"),
    );
    const insertIndex = sql.findIndex((statement) =>
      statement.includes("INSERT INTO event_store.events"),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(versionIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(versionIndex);
    expect(query.mock.calls[lockIndex]?.[1]).toEqual(["Order-1"]);
    expect(result).toEqual({
      streamId: "Order-1",
      fromVersion: 1,
      toVersion: 1,
      globalPositions: [1n],
      isDuplicate: false,
    });
  });

  it("returns the previous result without appending or notifying on an idempotent retry", async () => {
    const events = [{ type: "Created", data: { total: 100 } }];
    const query = createQuery({
      stream_id: "Order-1",
      request_hash: computeRequestHash(events),
      from_version: 1,
      to_version: 2,
      global_positions: ["10", "11"],
    });

    const result = await appendToStream({
      client: { query } as never,
      schema: "event_store",
      input: {
        streamId: "Order-1",
        expectedVersion: -1,
        events,
        idempotencyKey: "idem-key-1",
      },
      cryptoKeyManager: null,
    });

    expect(result).toEqual({
      streamId: "Order-1",
      fromVersion: 1,
      toVersion: 2,
      globalPositions: [10n, 11n],
      isDuplicate: true,
    });
    expectNoAppendSideEffects(query, "Order-1", "idem-key-1");
  });

  it("rejects an idempotency key used for another stream without appending", async () => {
    const query = createQuery({
      stream_id: "OtherStream-99",
      request_hash: "any-hash",
      from_version: 1,
      to_version: 1,
      global_positions: ["5"],
    });

    await expect(
      appendToStream({
        client: { query } as never,
        schema: "event_store",
        input: {
          streamId: "Order-1",
          expectedVersion: -1,
          events: [{ type: "Created", data: { total: 100 } }],
          idempotencyKey: "idem-key-conflict",
        },
        cryptoKeyManager: null,
      }),
    ).rejects.toThrow(/Idempotency conflict for key "idem-key-conflict"/);
    expectNoAppendSideEffects(query, "Order-1", "idem-key-conflict");
  });

  it("rejects an idempotency key used with a different payload without appending", async () => {
    const query = createQuery({
      stream_id: "Order-1",
      request_hash: "different-payload-hash",
      from_version: 1,
      to_version: 1,
      global_positions: ["5"],
    });

    await expect(
      appendToStream({
        client: { query } as never,
        schema: "event_store",
        input: {
          streamId: "Order-1",
          expectedVersion: -1,
          events: [{ type: "Created", data: { total: 100 } }],
          idempotencyKey: "idem-key-payload-conflict",
        },
        cryptoKeyManager: null,
      }),
    ).rejects.toThrow(/different event payload/);
    expectNoAppendSideEffects(query, "Order-1", "idem-key-payload-conflict");
  });
});
