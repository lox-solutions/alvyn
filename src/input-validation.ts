import { InvalidArgumentError } from "./errors";
import type {
  AppendInput,
  ListStreamsOptions,
  ReadEventsPageOptions,
} from "./types";
import type { SubscribeOptions } from "./subscription/subscribe-options";

export const MAX_READ_EVENTS_PAGE_LIMIT = 1000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStringArray(
  value: unknown,
  name: string,
): asserts value is string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new InvalidArgumentError(
      name,
      "must be an array of non-empty strings",
    );
  }
}

export function assertPositiveSafeInteger(value: unknown, name: string): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new InvalidArgumentError(name, "must be a positive safe integer");
  }
}

export function assertNonNegativeSafeInteger(
  value: unknown,
  name: string,
): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InvalidArgumentError(name, "must be a non-negative safe integer");
  }
}

function validateExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < -1) {
    throw new InvalidArgumentError(
      "expectedVersion",
      "must be -1, 0, or a positive safe integer",
    );
  }
}

function validateSchemaVersion(value: unknown): void {
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new InvalidArgumentError(
      "events[].schemaVersion",
      "must be a positive safe integer",
    );
  }
}

function validateEventSource(value: unknown): void {
  validateOptionalNonEmptyString(value, "events[].source");
}

function validateOptionalNonEmptyString(value: unknown, name: string): void {
  if (value !== undefined && !isNonEmptyString(value)) {
    throw new InvalidArgumentError(name, "must be a non-empty string");
  }
}

function validateOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new InvalidArgumentError(name, "must be a boolean");
  }
}

function validateOptionalStringArray(value: unknown, name: string): void {
  if (value !== undefined) assertStringArray(value, name);
}

function validateSubscriptionLowerBound(value: unknown): void {
  if (value === undefined) return;
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !/^(0|[1-9][0-9]*)$/.test(value.id)
  ) {
    throw new InvalidArgumentError(
      "lowerBound.id",
      "must be a non-negative integer string",
    );
  }
  if (
    value.type !== undefined &&
    value.type !== "exclusive" &&
    value.type !== "inclusive"
  ) {
    throw new InvalidArgumentError(
      "lowerBound.type",
      'must be "exclusive" or "inclusive"',
    );
  }
}

function validateEncryptedFields(event: AppendInput["events"][number]): void {
  if (event.encryptedFields === undefined) return;
  assertStringArray(event.encryptedFields, "events[].encryptedFields");
  if (event.encryptedFields.length > 0 && !isRecord(event.data)) {
    throw new InvalidArgumentError(
      "events[].data",
      "must be an object when encryptedFields are configured",
    );
  }
}

function validateAppendEvent(event: AppendInput["events"][number]): void {
  if (!event || !isNonEmptyString(event.type)) {
    throw new InvalidArgumentError(
      "events[].type",
      "must be a non-empty string",
    );
  }
  validateSchemaVersion(event.schemaVersion);
  validateEventSource(event.source);
  validateEncryptedFields(event);
}

export function validateAppendInput(input: AppendInput): void {
  if (!isRecord(input)) {
    throw new InvalidArgumentError("input", "must be an object");
  }
  if (!isNonEmptyString(input.streamId)) {
    throw new InvalidArgumentError("streamId", "must be a non-empty string");
  }
  validateExpectedVersion(input.expectedVersion);
  if (!Array.isArray(input.events)) {
    throw new InvalidArgumentError("events", "must be an array");
  }
  input.events.forEach(validateAppendEvent);
  if (input.outboxTopics !== undefined) {
    assertStringArray(input.outboxTopics, "outboxTopics");
    if (new Set(input.outboxTopics).size !== input.outboxTopics.length) {
      throw new InvalidArgumentError(
        "outboxTopics",
        "must not contain duplicates",
      );
    }
  }
}

export function validateListStreamsOptions(options?: ListStreamsOptions): void {
  if (options?.limit !== undefined) {
    assertPositiveSafeInteger(options.limit, "limit");
  }
}

export function validateReadEventsPageOptions(
  options: ReadEventsPageOptions,
): void {
  if (!isRecord(options)) {
    throw new InvalidArgumentError("options", "must be an object");
  }
  assertStringArray(options.streamIds, "streamIds");
  if (new Set(options.streamIds).size !== options.streamIds.length) {
    throw new InvalidArgumentError("streamIds", "must not contain duplicates");
  }
  assertPositiveSafeInteger(options.limit, "limit");
  if (options.limit > MAX_READ_EVENTS_PAGE_LIMIT) {
    throw new InvalidArgumentError(
      "limit",
      `must not exceed ${MAX_READ_EVENTS_PAGE_LIMIT}`,
    );
  }
  if (
    options.order !== undefined &&
    options.order !== "asc" &&
    options.order !== "desc"
  ) {
    throw new InvalidArgumentError("order", 'must be "asc" or "desc"');
  }
  if (options.cursor !== undefined && !isNonEmptyString(options.cursor)) {
    throw new InvalidArgumentError("cursor", "must be a non-empty string");
  }
}

export function validateSubscribeOptions(options: SubscribeOptions): void {
  if (!isRecord(options)) {
    throw new InvalidArgumentError("options", "must be an object");
  }
  validateOptionalNonEmptyString(options.subject, "subject");
  validateOptionalBoolean(options.recursive, "recursive");
  validateOptionalStringArray(options.eventTypes, "eventTypes");
  if (options.batchSize !== undefined) {
    assertPositiveSafeInteger(options.batchSize, "batchSize");
  }
  if (options.pollIntervalMs !== undefined) {
    assertNonNegativeSafeInteger(options.pollIntervalMs, "pollIntervalMs");
  }
  validateSubscriptionLowerBound(options.lowerBound);
}
