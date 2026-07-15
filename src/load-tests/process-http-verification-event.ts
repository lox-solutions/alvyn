import type { ReplayedEvent } from "../types";
import { AccountBalanceSnapshot } from "./http-aggregate";
import type { HttpLoadTestConfig } from "./http-types";
import type { SuccessfulDeposit } from "./run-http-operation";

const INITIAL_BALANCE = 0;
const SEED_DEPOSIT_AMOUNT = 1;
const ACCOUNT_OPENED_TYPE = "AccountOpened";
const MONEY_DEPOSITED_TYPE = "MoneyDeposited";

export interface AccountVerificationState {
  balance: number;
  sourceEventCount: number;
  storedEventCount: number;
  snapshotEventCount: number;
}

interface DepositVerificationOptions {
  event: ReplayedEvent;
  streamId: string;
  accountId: string;
  accountIndex: number;
  config: HttpLoadTestConfig;
  state: AccountVerificationState;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  seenLiveTokens: Set<string>;
}

type EventVerificationOptions = DepositVerificationOptions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function seedToken({
  config,
  accountIndex,
  sourceEventCount,
}: {
  config: HttpLoadTestConfig;
  accountIndex: number;
  sourceEventCount: number;
}): string {
  return `seed:${config.seed}:${accountIndex}:${sourceEventCount}`;
}

function validateLiveDeposit({
  amount,
  operationToken,
  accountId,
  successfulDeposits,
  seenLiveTokens,
}: {
  amount: number;
  operationToken: string;
  accountId: string;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  seenLiveTokens: Set<string>;
}): void {
  const expectedDeposit = successfulDeposits.get(operationToken);
  if (expectedDeposit?.accountId !== accountId) {
    throw new Error(`Unexpected live operation ${operationToken}`);
  }
  if (expectedDeposit.amount !== amount || seenLiveTokens.has(operationToken)) {
    throw new Error(`Duplicate or invalid live operation ${operationToken}`);
  }
  seenLiveTokens.add(operationToken);
}

function processDeposit({
  event,
  streamId,
  accountId,
  accountIndex,
  config,
  state,
  successfulDeposits,
  seenLiveTokens,
}: DepositVerificationOptions): AccountVerificationState {
  if (!isRecord(event.data)) throw new Error(`Invalid deposit in ${streamId}`);
  const amount = event.data.amount;
  const operationToken = event.data.operationToken;
  if (typeof amount !== "number" || typeof operationToken !== "string") {
    throw new Error(`Invalid deposit payload in ${streamId}`);
  }
  const isSeedDeposit =
    operationToken ===
    seedToken({
      config,
      accountIndex,
      sourceEventCount: state.sourceEventCount,
    });
  if (isSeedDeposit && amount !== SEED_DEPOSIT_AMOUNT) {
    throw new Error(`Invalid seed amount in ${streamId}`);
  }
  if (!isSeedDeposit)
    validateLiveDeposit({
      amount,
      operationToken,
      accountId,
      successfulDeposits,
      seenLiveTokens,
    });
  return {
    ...state,
    balance: state.balance + amount,
    sourceEventCount: state.sourceEventCount + 1,
  };
}

export function processHttpVerificationEvent({
  event,
  streamId,
  accountId,
  accountIndex,
  config,
  state,
  successfulDeposits,
  seenLiveTokens,
}: EventVerificationOptions): AccountVerificationState {
  if (event.type === ACCOUNT_OPENED_TYPE) {
    if (state.sourceEventCount !== 0) {
      throw new Error(`Invalid opening event in ${streamId}`);
    }
    if (
      !isRecord(event.data) ||
      event.data.initialBalance !== INITIAL_BALANCE
    ) {
      throw new Error(`Invalid opening payload in ${streamId}`);
    }
    return { ...state, sourceEventCount: 1 };
  }
  if (event.type === MONEY_DEPOSITED_TYPE) {
    return processDeposit({
      event,
      streamId,
      accountId,
      accountIndex,
      config,
      state,
      successfulDeposits,
      seenLiveTokens,
    });
  }
  if (event.type === AccountBalanceSnapshot.snapshotEventType) {
    if (
      !isRecord(event.data) ||
      event.data.status !== "open" ||
      event.data.balance !== state.balance
    ) {
      throw new Error(`Invalid snapshot payload in ${streamId}`);
    }
    return { ...state, snapshotEventCount: state.snapshotEventCount + 1 };
  }
  throw new Error(`Unexpected event type ${event.type} in ${streamId}`);
}
