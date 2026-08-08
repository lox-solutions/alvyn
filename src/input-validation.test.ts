import { describe, expect, it } from "vitest";

import { InvalidArgumentError } from "./errors";
import {
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
  validateAppendInput,
  validateListStreamsOptions,
  validateSubscribeOptions,
} from "./input-validation";

describe("runtime input validation", () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid positive integer %p",
    (value) => {
      expect(() => assertPositiveSafeInteger(value, "limit")).toThrow(
        InvalidArgumentError,
      );
    },
  );

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid non-negative integer %p",
    (value) => {
      expect(() => assertNonNegativeSafeInteger(value, "olderThanMs")).toThrow(
        InvalidArgumentError,
      );
    },
  );

  it.each([-2, -0.5, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects an invalid expected version %p",
    (expectedVersion) => {
      expect(() =>
        validateAppendInput({
          streamId: "Order-1",
          expectedVersion,
          events: [{ type: "Created", data: {} }],
        }),
      ).toThrow(InvalidArgumentError);
    },
  );

  it("accepts documented expected-version values", () => {
    for (const expectedVersion of [-1, 0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        validateAppendInput({
          streamId: "Order-1",
          expectedVersion,
          events: [{ type: "Created", data: {} }],
        }),
      ).not.toThrow();
    }
  });

  it("rejects malformed event metadata and stream listing limits", () => {
    expect(() =>
      validateAppendInput({
        streamId: "Order-1",
        expectedVersion: 0,
        events: [{ type: "", data: {} }],
      }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      validateAppendInput({
        streamId: "Order-1",
        expectedVersion: 0,
        events: [{ type: "Created", data: {}, schemaVersion: 0 }],
      }),
    ).toThrow(InvalidArgumentError);
    expect(() => validateListStreamsOptions({ limit: 0 })).toThrow(
      InvalidArgumentError,
    );
  });

  it("rejects malformed encryption and outbox settings", () => {
    expect(() =>
      validateAppendInput({
        streamId: "Order-1",
        expectedVersion: 0,
        events: [
          {
            type: "Created",
            data: "not an object",
            encryptedFields: ["customer.name"],
          },
        ],
      }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      validateAppendInput({
        streamId: "Order-1",
        expectedVersion: 0,
        events: [{ type: "Created", data: {}, encryptedFields: ["", "name"] }],
      }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      validateAppendInput({
        streamId: "Order-1",
        expectedVersion: 0,
        events: [{ type: "Created", data: {} }],
        outboxTopics: ["orders", "orders"],
      }),
    ).toThrow(InvalidArgumentError);
  });

  it("rejects cursors and settings that can busy-loop or break queries", () => {
    expect(() => validateSubscribeOptions({ batchSize: 0 })).toThrow(
      InvalidArgumentError,
    );
    expect(() => validateSubscribeOptions({ pollIntervalMs: -1 })).toThrow(
      InvalidArgumentError,
    );
    expect(() =>
      validateSubscribeOptions({ lowerBound: { id: "-1" } }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      validateSubscribeOptions({ lowerBound: { id: "001" } }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      validateSubscribeOptions({ lowerBound: { id: 1 } as never }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      validateSubscribeOptions({ lowerBound: null as never }),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      validateSubscribeOptions({
        lowerBound: { id: "1", type: "after" } as never,
      }),
    ).toThrow(InvalidArgumentError);
    expect(() => validateSubscribeOptions({ subject: "" })).toThrow(
      InvalidArgumentError,
    );
    expect(() => validateSubscribeOptions({ eventTypes: [""] })).toThrow(
      InvalidArgumentError,
    );
  });
});
