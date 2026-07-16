import { defineAggregate } from "../src/aggregate/define-aggregate";
import type { AggregateEventInput } from "../src/aggregate/types";
import { defineSnapshot } from "../src/snapshot/define-snapshot";

export interface AccountEvents {
  AccountOpened: { initialBalance: number };
  MoneyDeposited: { amount: number; operationToken: string };
}

export interface AccountState {
  status: "open";
  balance: number;
  depositCount: number;
  depositTotal: number;
}

export const AccountAggregate = defineAggregate<AccountState, AccountEvents>()({
  streamPrefix: "LoadTestAccount",
  evolve: {
    AccountOpened: (_state, event) => ({
      status: "open",
      balance: event.data?.initialBalance ?? 0,
      depositCount: 0,
      depositTotal: event.data?.initialBalance ?? 0,
    }),
    MoneyDeposited: (state, event) => ({
      ...state,
      balance: state.balance + (event.data?.amount ?? 0),
      depositCount: state.depositCount + 1,
      depositTotal: state.depositTotal + (event.data?.amount ?? 0),
    }),
  },
});

export const ACCOUNT_SNAPSHOT_EVERY = 50;

export const AccountBalanceSnapshot = defineSnapshot<
  AccountState,
  AccountEvents
>()({
  streamPrefix: AccountAggregate.streamPrefix,
  snapshotName: "LoadTestAccountBalance",
  every: ACCOUNT_SNAPSHOT_EVERY,
  initialState: {
    status: "open",
    balance: 0,
    depositCount: 0,
    depositTotal: 0,
  },
  evolve: {
    AccountOpened: (_state, event) => ({
      status: "open",
      balance: event.data?.initialBalance ?? 0,
      depositCount: 0,
      depositTotal: event.data?.initialBalance ?? 0,
    }),
    MoneyDeposited: (state, event) => ({
      ...state,
      balance: state.balance + (event.data?.amount ?? 0),
      depositCount: state.depositCount + 1,
      depositTotal: state.depositTotal + (event.data?.amount ?? 0),
    }),
  },
});

export function getAccountStreamId(accountId: string): string {
  return `${AccountAggregate.streamPrefix}-${accountId}`;
}

export function createSeedEvents({
  seed,
  accountIndex,
  eventCount,
}: {
  seed: number;
  accountIndex: number;
  eventCount: number;
}): AggregateEventInput<AccountEvents>[] {
  const events: AggregateEventInput<AccountEvents>[] = [
    {
      type: "AccountOpened",
      data: { initialBalance: 0 },
      extensions: {
        correlationid: `seed:${seed}:${accountIndex}:0`,
      },
    },
  ];
  for (let eventIndex = 1; eventIndex < eventCount; eventIndex++) {
    events.push({
      type: "MoneyDeposited",
      data: {
        amount: 1,
        operationToken: `seed:${seed}:${accountIndex}:${eventIndex}`,
      },
      extensions: {
        correlationid: `seed:${seed}:${accountIndex}:${eventIndex}`,
      },
    });
  }
  return events;
}

export function createSeedDepositEvents({
  seed,
  accountIndex,
  startEventIndex,
  eventCount,
}: {
  seed: number;
  accountIndex: number;
  startEventIndex: number;
  eventCount: number;
}): AggregateEventInput<AccountEvents>[] {
  return Array.from({ length: eventCount }, (_, offset) => {
    const eventIndex = startEventIndex + offset;
    return {
      type: "MoneyDeposited",
      data: {
        amount: 1,
        operationToken: `seed:${seed}:${accountIndex}:${eventIndex}`,
      },
      extensions: {
        correlationid: `seed:${seed}:${accountIndex}:${eventIndex}`,
      },
    };
  });
}
