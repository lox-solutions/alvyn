import { describe, expect, it, vi } from "vitest";

import { appendToStream } from "./append-to-stream";

describe("appendToStream", () => {
  it("uses a 64-bit advisory lock derived from the stream ID", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ max_version: null }] })
      .mockResolvedValueOnce({ rows: [{ global_position: "1" }] })
      .mockResolvedValueOnce({ rows: [] });

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

    expect(query.mock.calls[0]).toEqual([
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 1936024421))",
      ["Order-1"],
    ]);
    expect(result).toEqual({
      streamId: "Order-1",
      fromVersion: 1,
      toVersion: 1,
      globalPositions: [1n],
    });
  });

  it("returns existing result when idempotency key is found", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({
        rows: [
          {
            stream_id: "Order-1",
            from_version: 1,
            to_version: 2,
            global_positions: ["10", "11"],
          },
        ],
      }); // checkIdempotencyKey

    const result = await appendToStream({
      client: { query } as never,
      schema: "event_store",
      input: {
        streamId: "Order-1",
        expectedVersion: -1,
        events: [{ type: "Created", data: { total: 100 } }],
        idempotencyKey: "idem-key-1",
      },
      cryptoKeyManager: null,
    });

    expect(result).toEqual({
      streamId: "Order-1",
      fromVersion: 1,
      toVersion: 2,
      globalPositions: [10n, 11n],
    });
    // Should NOT have run version check, chunk inserts, outbox, or notifications
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("throws IdempotencyConflictError when idempotency key was used for a different stream", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({
        rows: [
          {
            stream_id: "OtherStream-99",
            from_version: 1,
            to_version: 1,
            global_positions: ["5"],
          },
        ],
      }); // checkIdempotencyKey

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
  });
});
