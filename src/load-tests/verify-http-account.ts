import { EventStore } from "../event-store";
import type { HttpLoadTestConfig } from "./http-types";
import { getAccountStreamId } from "./http-aggregate";
import type { SuccessfulDeposit } from "./run-http-operation";
import {
  processHttpVerificationEvent,
  type AccountVerificationState,
} from "./process-http-verification-event";

export type { AccountVerificationState } from "./process-http-verification-event";

const VERIFICATION_PAGE_SIZE = 1_000;
const FIRST_STREAM_VERSION = 1;
const INITIAL_BALANCE = 0;

interface LoadAccountEventsOptions {
  eventStore: EventStore;
  streamId: string;
  accountId: string;
  accountIndex: number;
  config: HttpLoadTestConfig;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  seenLiveTokens: Set<string>;
}

interface LoadedAccountEvents {
  state: AccountVerificationState;
  streamVersion: number;
}

function processHttpAccountPage({
  events,
  streamId,
  accountId,
  accountIndex,
  config,
  state,
  successfulDeposits,
  seenLiveTokens,
}: {
  events: Awaited<ReturnType<EventStore["loadFrom"]>>;
  streamId: string;
  accountId: string;
  accountIndex: number;
  config: HttpLoadTestConfig;
  state: AccountVerificationState;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  seenLiveTokens: Set<string>;
}): AccountVerificationState {
  for (const event of events) {
    const expectedVersion = state.storedEventCount + FIRST_STREAM_VERSION;
    if (event.streamVersion !== expectedVersion) {
      throw new Error(
        `Non-contiguous ${streamId}: expected ${expectedVersion}, got ${event.streamVersion}`,
      );
    }
    state = processHttpVerificationEvent({
      event,
      streamId,
      accountId,
      accountIndex,
      config,
      state,
      successfulDeposits,
      seenLiveTokens,
    });
    state.storedEventCount++;
  }
  return state;
}

async function loadAccountPages({
  eventStore,
  streamId,
  accountId,
  accountIndex,
  config,
  successfulDeposits,
  seenLiveTokens,
  streamVersion,
}: LoadAccountEventsOptions & {
  streamVersion: number;
}): Promise<AccountVerificationState> {
  let fromVersion = FIRST_STREAM_VERSION;
  let state: AccountVerificationState = {
    balance: INITIAL_BALANCE,
    sourceEventCount: 0,
    storedEventCount: 0,
    snapshotEventCount: 0,
  };
  while (fromVersion <= streamVersion) {
    const events = await eventStore.loadFrom(streamId, {
      fromVersion,
      maxEvents: VERIFICATION_PAGE_SIZE,
    });
    if (events.length === 0)
      throw new Error(
        `Missing events for ${streamId} from version ${fromVersion}`,
      );
    state = processHttpAccountPage({
      events,
      streamId,
      accountId,
      accountIndex,
      config,
      state,
      successfulDeposits,
      seenLiveTokens,
    });
    fromVersion += events.length;
  }
  return state;
}

async function loadAccountEvents({
  eventStore,
  streamId,
  accountId,
  accountIndex,
  config,
  successfulDeposits,
  seenLiveTokens,
}: LoadAccountEventsOptions): Promise<LoadedAccountEvents> {
  const streamVersion = await eventStore.getStreamVersion(streamId);
  const state = await loadAccountPages({
    eventStore,
    streamId,
    accountId,
    accountIndex,
    config,
    successfulDeposits,
    seenLiveTokens,
    streamVersion,
  });
  return { state, streamVersion };
}

export async function verifyHttpAccount({
  eventStore,
  config,
  accountId,
  accountIndex,
  expectedBalance,
  expectedSourceEventCount,
  successfulDeposits,
  seenLiveTokens,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  accountId: string;
  accountIndex: number;
  expectedBalance: number;
  expectedSourceEventCount: number;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  seenLiveTokens: Set<string>;
}): Promise<AccountVerificationState> {
  const streamId = getAccountStreamId(accountId);
  const { state, streamVersion } = await loadAccountEvents({
    eventStore,
    streamId,
    accountId,
    accountIndex,
    config,
    successfulDeposits,
    seenLiveTokens,
  });
  if (state.storedEventCount !== streamVersion) {
    throw new Error(
      `Version mismatch for ${streamId}: read ${state.storedEventCount}, version ${streamVersion}`,
    );
  }
  if (state.sourceEventCount !== expectedSourceEventCount) {
    throw new Error(
      `Source event count mismatch for ${streamId}: expected ${expectedSourceEventCount}, got ${state.sourceEventCount}`,
    );
  }
  if (state.balance !== expectedBalance) {
    throw new Error(
      `Balance mismatch for ${accountId}: expected ${expectedBalance}, got ${state.balance}`,
    );
  }
  return state;
}
