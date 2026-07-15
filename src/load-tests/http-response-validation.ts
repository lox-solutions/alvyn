import { getAccountStreamId } from "./http-aggregate";
import type { HttpOperationPlan } from "./http-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireEqual(
  actual: unknown,
  expected: string | number,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function validateRead(operation: HttpOperationPlan, body: unknown): void {
  const aggregate = requireRecord(body, "read response");
  requireEqual(
    aggregate.streamId,
    getAccountStreamId(operation.accountId),
    "read response streamId",
  );
  const version = requireNonNegativeInteger(
    aggregate.version,
    "read response version",
  );
  if (version === 0) throw new Error("read response version must be positive");
  const state = requireRecord(aggregate.state, "read response state");
  requireEqual(state.status, "open", "read response status");
  if (
    typeof state.balance !== "number" ||
    !Number.isFinite(state.balance) ||
    state.balance < 0
  ) {
    throw new Error(
      "read response balance must be a finite non-negative number",
    );
  }
  const depositCount = requireNonNegativeInteger(
    state.depositCount,
    "read response depositCount",
  );
  if (version < depositCount + 1) {
    throw new Error(
      `read response version mismatch: expected at least ${depositCount + 1} from depositCount, got ${version}`,
    );
  }
  if (
    typeof state.depositTotal !== "number" ||
    !Number.isFinite(state.depositTotal) ||
    state.depositTotal < 0
  ) {
    throw new Error(
      "read response depositTotal must be a finite non-negative number",
    );
  }
  if (state.balance !== state.depositTotal) {
    throw new Error(
      `read response balance mismatch: expected ${state.depositTotal} from depositTotal, got ${state.balance}`,
    );
  }
}

function validateDeposit(operation: HttpOperationPlan, body: unknown): void {
  const result = requireRecord(body, "deposit response");
  requireEqual(
    result.accountId,
    operation.accountId,
    "deposit response accountId",
  );
  requireEqual(result.amount, operation.amount, "deposit response amount");
  requireEqual(
    result.operationToken,
    operation.operationToken,
    "deposit response operationToken",
  );
  const fromVersion = requireNonNegativeInteger(
    result.fromVersion,
    "deposit response fromVersion",
  );
  const toVersion = requireNonNegativeInteger(
    result.toVersion,
    "deposit response toVersion",
  );
  if (toVersion !== fromVersion) {
    throw new Error("deposit response version range must contain one event");
  }
}

export function validateHttpOperationResponse(
  operation: HttpOperationPlan,
  body: unknown,
): void {
  if (operation.kind === "read") validateRead(operation, body);
  else validateDeposit(operation, body);
}
