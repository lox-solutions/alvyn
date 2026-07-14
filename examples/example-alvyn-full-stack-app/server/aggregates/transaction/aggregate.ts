import { defineAggregate, defineSnapshot } from "@lox-solutions/alvyn";

export type TransactionEvents = {
  Deposit: { bankAccountId: string; amount: number };
  Withdrawal: { bankAccountId: string; amount: number };
  TransactionReverted: { reason: string };
};

export type TransactionState = {
  type: "deposit" | "withdrawal";
  bankAccountId: string;
  amount: number;
  reverted: boolean;
  revertedReason?: string;
};

export const Transaction = defineAggregate<
  TransactionState,
  TransactionEvents
>()({
  streamPrefix: "Transaction",
  evolve: {
    Deposit: (_state, event) => ({
      type: "deposit",
      bankAccountId: event.data?.bankAccountId ?? "",
      amount: event.data?.amount ?? 0,
      reverted: false,
    }),
    Withdrawal: (_state, event) => ({
      type: "withdrawal",
      bankAccountId: event.data?.bankAccountId ?? "",
      amount: event.data?.amount ?? 0,
      reverted: false,
    }),
    TransactionReverted: (state, event) => ({
      ...state,
      reverted: true,
      revertedReason: event.data?.reason,
    }),
  },
});

export const BankAccountBalance = defineSnapshot<
  { balance: number },
  TransactionEvents
>()({
  streamPrefix: Transaction.streamPrefix,
  snapshotName: "BankAccountBalance",
  every: 5,
  initialState: { balance: 0 },
  evolve: {
    Deposit: (state, event) => ({
      balance: state.balance + Number(event.data?.amount ?? 0),
    }),
    Withdrawal: (state, event) => ({
      balance: state.balance - Number(event.data?.amount ?? 0),
    }),
  },
});
