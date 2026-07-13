import { defineAggregate } from "../aggregate/define-aggregate";
import type { AggregateEventInput } from "../aggregate/types";

export type AccountEvents = {
  AccountOpened: { initialBalance: number };
  MoneyDeposited: { amount: number; operationToken: string };
};

export interface AccountState {
  status: "open";
  balance: number;
}

export const AccountAggregate = defineAggregate<AccountState, AccountEvents>()({
  streamPrefix: "LoadTestAccount",
  evolve: {
    AccountOpened: (_state, event) => ({
      status: "open",
      balance: event.data?.initialBalance ?? 0,
    }),
    MoneyDeposited: (state, event) => ({
      ...state,
      balance: state.balance + (event.data?.amount ?? 0),
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
