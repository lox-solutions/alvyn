import { defineAggregate } from "@lox-solutions/alvyn";

export type BankAccountEvents = {
  AccountOpened: { ownerName: string };
  AccountClosed: { reason: string };
  AccountBlocked: { reason: string };
  AccountUnblocked: Record<string, never>;
};

export type BankAccountState = {
  status: "opened" | "closed" | "blocked";
  ownerName: string;
};

export const BankAccount = defineAggregate<
  BankAccountState,
  BankAccountEvents
>()({
  streamPrefix: "BankAccount",
  evolve: {
    AccountOpened: (_state, event) => ({
      status: "opened",
      ownerName: event.data?.ownerName ?? "",
    }),
    AccountClosed: (state) => ({
      ...state,
      status: "closed",
    }),
    AccountBlocked: (state) => ({
      ...state,
      status: "blocked",
    }),
    AccountUnblocked: (state) => ({
      ...state,
      status: "opened",
    }),
  },
});
