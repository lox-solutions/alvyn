import { EventStore } from "../src/event-store";
import {
  AccountAggregate,
  AccountBalanceSnapshot,
  createSeedDepositEvents,
  createSeedEvents,
  getAccountStreamId,
} from "./http-aggregate";
import type { HttpLoadTestConfig } from "./http-types";
import { getAccountIds } from "./http-workload";
import { ProgressRenderer } from "./progress";

export interface SeedSummary {
  accountIds: string[];
  historyEventCounts: number[];
  eventCount: number;
  snapshotEventCount: number;
}

export function getSnapshotBenchmarkAccountIds(
  config: HttpLoadTestConfig,
): string[] {
  const accountIds = getAccountIds(config);
  const benchmarkAccountCount = Math.min(
    config.snapshotBenchmarkRequests,
    accountIds.length,
  );
  return accountIds.slice(accountIds.length - benchmarkAccountCount);
}

function getHistoryEventCounts({
  accountIds,
  config,
}: {
  accountIds: string[];
  config: HttpLoadTestConfig;
}): number[] {
  const benchmarkAccountCount = getSnapshotBenchmarkAccountIds(config).length;
  const benchmarkAccountStart = accountIds.length - benchmarkAccountCount;
  return accountIds.map((_, accountIndex) =>
    accountIndex >= benchmarkAccountStart
      ? Math.max(
          config.historyEventsPerAccount,
          config.snapshotBenchmarkHistoryEventsPerAccount,
        )
      : config.historyEventsPerAccount,
  );
}

async function appendSeedBatch({
  eventStore,
  config,
  accountId,
  accountIndex,
  startEventIndex,
  batchSize,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  accountId: string;
  accountIndex: number;
  startEventIndex: number;
  batchSize: number;
}): Promise<void> {
  await AccountAggregate.append(eventStore, {
    entityId: accountId,
    expectedVersion: startEventIndex,
    events: createSeedDepositEvents({
      seed: config.seed,
      accountIndex,
      startEventIndex,
      eventCount: batchSize,
    }),
  });
}

async function seedAccount({
  eventStore,
  config,
  accountId,
  accountIndex,
  historyEvents,
  progress,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  accountId: string;
  accountIndex: number;
  historyEvents: number;
  progress: ProgressRenderer;
}): Promise<number> {
  await AccountAggregate.append(eventStore, {
    entityId: accountId,
    expectedVersion: -1,
    events: createSeedEvents({
      seed: config.seed,
      accountIndex,
      eventCount: 1,
    }),
  });
  let eventCount = 1;
  for (
    let startEventIndex = 1;
    startEventIndex < historyEvents;
    startEventIndex += config.seedBatchSize
  ) {
    const batchSize = Math.min(
      config.seedBatchSize,
      historyEvents - startEventIndex,
    );
    await appendSeedBatch({
      eventStore,
      config,
      accountId,
      accountIndex,
      startEventIndex,
      batchSize,
    });
    eventCount += batchSize;
  }
  progress.update(
    `seeding accounts: ${accountIndex + 1}/${config.accountCount} | events: ${eventCount}`,
  );
  return eventCount;
}

export async function seedAccounts({
  eventStore,
  config,
  progress,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  progress: ProgressRenderer;
}): Promise<SeedSummary> {
  const accountIds = getAccountIds(config);
  const historyEventCounts = getHistoryEventCounts({ accountIds, config });
  let eventCount = 0;
  for (const [accountIndex, accountId] of accountIds.entries()) {
    eventCount += await seedAccount({
      eventStore,
      config,
      accountId,
      accountIndex,
      historyEvents: historyEventCounts[accountIndex] ?? 0,
      progress,
    });
  }
  return {
    accountIds,
    historyEventCounts,
    eventCount,
    snapshotEventCount: 0,
  };
}

export async function seedAccountSnapshots({
  eventStore,
  config,
  seedSummary,
  progress,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  seedSummary: SeedSummary;
  progress: ProgressRenderer;
}): Promise<void> {
  const snapshotAccountIds = getSnapshotBenchmarkAccountIds(config);
  for (const [snapshotIndex, accountId] of snapshotAccountIds.entries()) {
    const accountIndex = seedSummary.accountIds.indexOf(accountId);
    const historyEvents = seedSummary.historyEventCounts[accountIndex] ?? 0;
    await eventStore.appendSnapshot({
      streamId: getAccountStreamId(accountId),
      expectedVersion: historyEvents,
      events: [
        {
          type: AccountBalanceSnapshot.snapshotEventType,
          data: {
            status: "open",
            balance: Math.max(0, historyEvents - 1),
            depositCount: Math.max(0, historyEvents - 1),
            depositTotal: Math.max(0, historyEvents - 1),
          },
        },
      ],
    });
    seedSummary.snapshotEventCount++;
    progress.update(
      `seeding snapshots: ${snapshotIndex + 1}/${snapshotAccountIds.length}`,
    );
  }
}
