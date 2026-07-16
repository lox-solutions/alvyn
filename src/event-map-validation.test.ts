import { describe, expect, it } from "vitest";
import { defineAggregate } from "./aggregate/define-aggregate";
import { defineProjection } from "./projection/define-projection";
import { defineSnapshot } from "./snapshot/define-snapshot";

type BankAccountState = {
  status: "not-opened" | "open" | "closed";
  ownerName: string;
  balance: number;
};

/** The event contract as it might be declared in an aggregate module. */
interface BankAccountEvents {
  AccountOpened: { ownerName: string; initialBalance: number };
  MoneyDeposited: { amount: number; transactionId: string };
  MoneyWithdrawn: { amount: number; transactionId: string };
  AccountClosed: { reason: string };
}

/** The same domain contract as it might be exported from a shared type file. */
type BankAccountEventMap = {
  AccountOpened: BankAccountEvents["AccountOpened"];
  MoneyDeposited: BankAccountEvents["MoneyDeposited"];
  MoneyWithdrawn: BankAccountEvents["MoneyWithdrawn"];
  AccountClosed: BankAccountEvents["AccountClosed"];
};

const accountBalances = new Map<string, number>();

const BankAccount = defineAggregate<BankAccountState, BankAccountEvents>()({
  streamPrefix: "BankAccount",
  evolve: {
    AccountOpened: (_state, event) => ({
      status: "open",
      ownerName: event.data?.ownerName ?? "",
      balance: event.data?.initialBalance ?? 0,
    }),
    MoneyDeposited: (state, event) => ({
      ...state,
      balance: state.balance + (event.data?.amount ?? 0),
    }),
    MoneyWithdrawn: (state, event) => ({
      ...state,
      balance: state.balance - (event.data?.amount ?? 0),
    }),
    AccountClosed: (state) => ({ ...state, status: "closed" }),
  },
});

const AccountBalanceProjection = defineProjection<BankAccountEventMap>()({
  projectionName: "bank-account-balances",
  streamPrefix: "BankAccount",
  handlers: {
    AccountOpened: (data, context) => {
      accountBalances.set(context.entityId, data.initialBalance);
    },
    MoneyDeposited: (data, context) => {
      const currentBalance = accountBalances.get(context.entityId) ?? 0;
      accountBalances.set(context.entityId, currentBalance + data.amount);
    },
    MoneyWithdrawn: (data, context) => {
      const currentBalance = accountBalances.get(context.entityId) ?? 0;
      accountBalances.set(context.entityId, currentBalance - data.amount);
    },
    AccountClosed: (_data, context) => {
      accountBalances.delete(context.entityId);
    },
  },
});

const BankAccountSnapshot = defineSnapshot<
  BankAccountState,
  BankAccountEventMap
>()({
  streamPrefix: "BankAccount",
  snapshotName: "BankAccountState",
  every: 100,
  initialState: { status: "not-opened", ownerName: "", balance: 0 },
  evolve: {
    AccountOpened: (_state, event) => ({
      status: "open",
      ownerName: event.data?.ownerName ?? "",
      balance: event.data?.initialBalance ?? 0,
    }),
    MoneyDeposited: (state, event) => ({
      ...state,
      balance: state.balance + (event.data?.amount ?? 0),
    }),
    MoneyWithdrawn: (state, event) => ({
      ...state,
      balance: state.balance - (event.data?.amount ?? 0),
    }),
    AccountClosed: (state) => ({ ...state, status: "closed" }),
  },
});

type AnyEventMap = ReturnType<typeof JSON.parse>;

type DefinitionArgument<TDefinitionBuilder> = TDefinitionBuilder extends (
  definition: infer TDefinition,
) => unknown
  ? TDefinition
  : never;

type AggregateDefinitionArgument<TEvents> = DefinitionArgument<
  ReturnType<typeof defineAggregate<BankAccountState, TEvents>>
>;

type ProjectionDefinitionArgument<TEvents> = DefinitionArgument<
  ReturnType<typeof defineProjection<TEvents>>
>;

type SnapshotDefinitionArgument<TEvents> = DefinitionArgument<
  ReturnType<typeof defineSnapshot<BankAccountState, TEvents>>
>;

type IsRejected<TDefinition> = [TDefinition] extends [never] ? true : false;

// These cases model values that are not usable as a domain event contract.
type AggregateRejectsInvalidEventMaps = [
  IsRejected<AggregateDefinitionArgument<string>>,
  IsRejected<AggregateDefinitionArgument<unknown>>,
  IsRejected<AggregateDefinitionArgument<never>>,
  IsRejected<AggregateDefinitionArgument<object>>,
  IsRejected<AggregateDefinitionArgument<[]>>,
  IsRejected<AggregateDefinitionArgument<readonly string[]>>,
  IsRejected<AggregateDefinitionArgument<{ 1: string }>>,
  IsRejected<AggregateDefinitionArgument<Record<symbol, string>>>,
  IsRejected<AggregateDefinitionArgument<AnyEventMap>>,
];

type ProjectionRejectsInvalidEventMaps = [
  IsRejected<ProjectionDefinitionArgument<string>>,
  IsRejected<ProjectionDefinitionArgument<unknown>>,
  IsRejected<ProjectionDefinitionArgument<never>>,
  IsRejected<ProjectionDefinitionArgument<object>>,
  IsRejected<ProjectionDefinitionArgument<[]>>,
  IsRejected<ProjectionDefinitionArgument<readonly string[]>>,
  IsRejected<ProjectionDefinitionArgument<{ 1: string }>>,
  IsRejected<ProjectionDefinitionArgument<Record<symbol, string>>>,
  IsRejected<ProjectionDefinitionArgument<AnyEventMap>>,
];

type SnapshotRejectsInvalidEventMaps = [
  IsRejected<SnapshotDefinitionArgument<string>>,
  IsRejected<SnapshotDefinitionArgument<unknown>>,
  IsRejected<SnapshotDefinitionArgument<never>>,
  IsRejected<SnapshotDefinitionArgument<object>>,
  IsRejected<SnapshotDefinitionArgument<[]>>,
  IsRejected<SnapshotDefinitionArgument<readonly string[]>>,
  IsRejected<SnapshotDefinitionArgument<{ 1: string }>>,
  IsRejected<SnapshotDefinitionArgument<Record<symbol, string>>>,
  IsRejected<SnapshotDefinitionArgument<AnyEventMap>>,
];

type AggregateAcceptsBankAccountEvents = [
  IsRejected<AggregateDefinitionArgument<BankAccountEvents>>,
  IsRejected<AggregateDefinitionArgument<BankAccountEventMap>>,
];

type ProjectionAcceptsBankAccountEvents = [
  IsRejected<ProjectionDefinitionArgument<BankAccountEvents>>,
  IsRejected<ProjectionDefinitionArgument<BankAccountEventMap>>,
];

type SnapshotAcceptsBankAccountEvents = [
  IsRejected<SnapshotDefinitionArgument<BankAccountEvents>>,
  IsRejected<SnapshotDefinitionArgument<BankAccountEventMap>>,
];

const aggregateRejectsInvalidEventMaps: AggregateRejectsInvalidEventMaps = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

const projectionRejectsInvalidEventMaps: ProjectionRejectsInvalidEventMaps = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

const snapshotRejectsInvalidEventMaps: SnapshotRejectsInvalidEventMaps = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

const aggregateAcceptsBankAccountEvents: AggregateAcceptsBankAccountEvents = [
  false,
  false,
];

const projectionAcceptsBankAccountEvents: ProjectionAcceptsBankAccountEvents = [
  false,
  false,
];

const snapshotAcceptsBankAccountEvents: SnapshotAcceptsBankAccountEvents = [
  false,
  false,
];

describe("event-map definition boundaries", () => {
  it("accepts a bank-account aggregate, projection, and snapshot", () => {
    expect(BankAccount.streamPrefix).toBe("BankAccount");
    expect(AccountBalanceProjection.projectionName).toBe(
      "bank-account-balances",
    );
    expect(BankAccountSnapshot.snapshotEventType).toBe(
      "BankAccountStateSnapshot",
    );
    expect(BankAccountSnapshot.sourceEventTypes).toEqual([
      "AccountOpened",
      "MoneyDeposited",
      "MoneyWithdrawn",
      "AccountClosed",
    ]);
  });

  it("rejects values that cannot describe domain events", () => {
    expect(aggregateRejectsInvalidEventMaps.every((check) => check)).toBe(true);
    expect(projectionRejectsInvalidEventMaps.every((check) => check)).toBe(
      true,
    );
    expect(snapshotRejectsInvalidEventMaps.every((check) => check)).toBe(true);
  });

  it("accepts both interface and type-alias event contracts", () => {
    expect(aggregateAcceptsBankAccountEvents.every((check) => !check)).toBe(
      true,
    );
    expect(projectionAcceptsBankAccountEvents.every((check) => !check)).toBe(
      true,
    );
    expect(snapshotAcceptsBankAccountEvents.every((check) => !check)).toBe(
      true,
    );
  });
});
