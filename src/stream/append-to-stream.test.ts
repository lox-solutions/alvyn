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
});
