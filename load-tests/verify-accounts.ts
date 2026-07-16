import { EventStore } from "../src/event-store";
import type { HttpLoadTestConfig, HttpVerificationSummary } from "./http-types";
import type { SeedSummary } from "./http-seeding";
import type { SuccessfulDeposit } from "./run-http-operation";
import {
  verifyHttpAccount,
  type AccountVerificationState,
} from "./verify-http-account";
import { ProgressRenderer } from "./progress";

interface VerificationTotals {
  eventCount: number;
  storedEventCount: number;
  snapshotEventCount: number;
  finalBalance: number;
  seenLiveTokens: Set<string>;
}

interface VerifyAccountsOptions {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  seedSummary: SeedSummary;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  progress: ProgressRenderer;
}

function buildExpectedValues({
  seedSummary,
  successfulDeposits,
}: {
  seedSummary: SeedSummary;
  successfulDeposits: Map<string, SuccessfulDeposit>;
}): {
  balances: Map<string, number>;
  sourceEventCounts: Map<string, number>;
} {
  const balances = new Map<string, number>();
  const sourceEventCounts = new Map<string, number>();
  for (const [accountIndex, accountId] of seedSummary.accountIds.entries()) {
    const historyEvents = seedSummary.historyEventCounts[accountIndex] ?? 0;
    balances.set(accountId, historyEvents - 1);
    sourceEventCounts.set(accountId, historyEvents);
  }
  for (const deposit of successfulDeposits.values()) {
    balances.set(
      deposit.accountId,
      (balances.get(deposit.accountId) ?? 0) + deposit.amount,
    );
    sourceEventCounts.set(
      deposit.accountId,
      (sourceEventCounts.get(deposit.accountId) ?? 0) + 1,
    );
  }
  return { balances, sourceEventCounts };
}

async function verifyAccountSet({
  eventStore,
  config,
  seedSummary,
  expected,
  successfulDeposits,
  progress,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  seedSummary: SeedSummary;
  expected: ReturnType<typeof buildExpectedValues>;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  progress: ProgressRenderer;
}): Promise<VerificationTotals> {
  const seenLiveTokens = new Set<string>();
  const totals: VerificationTotals = {
    eventCount: 0,
    storedEventCount: 0,
    snapshotEventCount: 0,
    finalBalance: 0,
    seenLiveTokens,
  };
  for (const [accountIndex, accountId] of seedSummary.accountIds.entries()) {
    const state: AccountVerificationState = await verifyHttpAccount({
      eventStore,
      config,
      accountId,
      accountIndex,
      expectedBalance: expected.balances.get(accountId) ?? 0,
      expectedSourceEventCount: expected.sourceEventCounts.get(accountId) ?? 0,
      successfulDeposits,
      seenLiveTokens,
    });
    totals.eventCount += state.sourceEventCount;
    totals.storedEventCount += state.storedEventCount;
    totals.snapshotEventCount += state.snapshotEventCount;
    totals.finalBalance += state.balance;
    progress.update(
      `verifying accounts: ${accountIndex + 1}/${seedSummary.accountIds.length} | stored events: ${totals.storedEventCount}`,
    );
  }
  return totals;
}

export async function verifyAccounts(
  options: VerifyAccountsOptions,
): Promise<HttpVerificationSummary> {
  const { eventStore, config, seedSummary, successfulDeposits, progress } =
    options;
  const expected = buildExpectedValues({ seedSummary, successfulDeposits });
  const totals = await verifyAccountSet({
    eventStore,
    config,
    seedSummary,
    expected,
    successfulDeposits,
    progress,
  });
  const {
    eventCount,
    storedEventCount,
    snapshotEventCount,
    finalBalance,
    seenLiveTokens,
  } = totals;
  if (seenLiveTokens.size !== successfulDeposits.size) {
    throw new Error(
      `Missing successful HTTP operations: expected ${successfulDeposits.size}, found ${seenLiveTokens.size}`,
    );
  }
  const expectedEventCount = seedSummary.eventCount + successfulDeposits.size;
  if (eventCount !== expectedEventCount) {
    throw new Error(
      `Event count mismatch: expected ${expectedEventCount}, got ${eventCount}`,
    );
  }
  if (snapshotEventCount < seedSummary.snapshotEventCount) {
    throw new Error(
      `Snapshot count mismatch: expected at least ${seedSummary.snapshotEventCount}, got ${snapshotEventCount}`,
    );
  }
  return {
    accountCount: seedSummary.accountIds.length,
    eventCount,
    storedEventCount,
    snapshotEventCount,
    expectedEventCount,
    seedEventCount: seedSummary.eventCount,
    seedSnapshotEventCount: seedSummary.snapshotEventCount,
    successfulDeposits: successfulDeposits.size,
    finalBalance,
  };
}
