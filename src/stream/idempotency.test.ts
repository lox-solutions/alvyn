import { describe, expect, it, vi } from "vitest";
import { InvalidSchemaNameError } from "../errors";
import {
  canonicalJsonStringify,
  checkIdempotencyKey,
  cleanupIdempotencyKeys,
  computeRequestHash,
  recordIdempotencyKey,
} from "./idempotency";

describe("idempotency helpers", () => {
  describe("canonicalJsonStringify", () => {
    it("serializes primitives and null identically to JSON.stringify", () => {
      expect(canonicalJsonStringify(null)).toBe("null");
      expect(canonicalJsonStringify("text")).toBe('"text"');
      expect(canonicalJsonStringify(123)).toBe("123");
      expect(canonicalJsonStringify(true)).toBe("true");
    });

    it("sorts object keys recursively", () => {
      const obj1 = { b: 2, a: 1, c: { y: 20, x: 10 } };
      const obj2 = { a: 1, c: { x: 10, y: 20 }, b: 2 };
      expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
      expect(canonicalJsonStringify(obj1)).toBe(
        '{"a":1,"b":2,"c":{"x":10,"y":20}}',
      );
    });

    it("handles toJSON methods", () => {
      const date = new Date("2026-09-07T12:00:00.000Z");
      expect(canonicalJsonStringify({ date })).toBe(
        '{"date":"2026-09-07T12:00:00.000Z"}',
      );
    });

    it("handles arrays and undefined values", () => {
      expect(canonicalJsonStringify([1, undefined, 3])).toBe("[1,null,3]");
      expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    });
  });

  describe("computeRequestHash", () => {
    it("produces identical hashes for objects with different property orders", () => {
      const hash1 = computeRequestHash([
        { type: "Created", data: { b: 2, a: 1 } },
      ]);
      const hash2 = computeRequestHash([
        { type: "Created", data: { a: 1, b: 2 } },
      ]);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes when outbox topics differ", () => {
      const hash1 = computeRequestHash({
        events: [{ type: "Created", data: { a: 1 } }],
        outboxTopics: ["topicA"],
      });
      const hash2 = computeRequestHash({
        events: [{ type: "Created", data: { a: 1 } }],
        outboxTopics: ["topicB"],
      });
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("schema validation", () => {
    const invalidSchema = "invalid;schema--";

    it("throws InvalidSchemaNameError in checkIdempotencyKey", async () => {
      await expect(
        checkIdempotencyKey({
          client: { query: vi.fn() } as never,
          schema: invalidSchema,
          idempotencyKey: "key-1",
          streamId: "stream-1",
          requestHash: "hash-1",
        }),
      ).rejects.toThrow(InvalidSchemaNameError);
    });

    it("throws InvalidSchemaNameError in recordIdempotencyKey", async () => {
      await expect(
        recordIdempotencyKey({
          client: { query: vi.fn() } as never,
          schema: invalidSchema,
          idempotencyKey: "key-1",
          streamId: "stream-1",
          requestHash: "hash-1",
          fromVersion: 1,
          toVersion: 1,
          globalPositions: [1n],
        }),
      ).rejects.toThrow(InvalidSchemaNameError);
    });

    it("throws InvalidSchemaNameError in cleanupIdempotencyKeys", async () => {
      await expect(
        cleanupIdempotencyKeys({
          pool: { connect: vi.fn() } as never,
          schema: invalidSchema,
        }),
      ).rejects.toThrow(InvalidSchemaNameError);
    });
  });
});
