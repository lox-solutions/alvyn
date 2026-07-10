import { Elysia } from "elysia";
import { createYoga, createSchema } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { Pool } from "pg";
import {
  EventStore,
  type AggregateReplayedEvent,
  type AggregateStoredEvent,
} from "@lox-solutions/alvyn";
import { BankAccount } from "./server/aggregates/bank-account";
import {
  BankAccountBalance,
  Transaction,
} from "./server/aggregates/transaction";
import type { TransactionEvents } from "./server/aggregates/transaction";

declare global {
  var __dbPool: Pool | undefined;
  var __eventStore: EventStore | undefined;
  var __connectionString: string | undefined;
  var __ignoreClosedReadableStreamConsoleErrors: boolean | undefined;
}

async function getOrCreateDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. The Vite dev configuration starts the development database, or provide DATABASE_URL explicitly.",
    );
  }

  if (
    globalThis.__dbPool &&
    globalThis.__eventStore &&
    globalThis.__connectionString === connectionString
  ) {
    console.log(`♻️ Reusing existing database connection`);
    return { pool: globalThis.__dbPool, eventStore: globalThis.__eventStore };
  }

  if (globalThis.__dbPool) {
    await globalThis.__dbPool.end();
  }

  globalThis.__connectionString = connectionString;
  globalThis.__dbPool = new Pool({ connectionString });
  globalThis.__eventStore = new EventStore({
    pool: globalThis.__dbPool,
    snapshots: [BankAccountBalance],
  });

  await globalThis.__eventStore.setup();

  return { pool: globalThis.__dbPool, eventStore: globalThis.__eventStore };
}

const { eventStore } = await getOrCreateDatabase();

type ClientErrorPayloadByCode = {
  INSUFFICIENT_FUNDS: {
    currentBalance: number;
    requestedAmount: number;
  };
};

type ClientErrorCode = keyof ClientErrorPayloadByCode;

class ClientGraphQLError<TCode extends ClientErrorCode> extends GraphQLError {
  constructor(
    message: string,
    code: TCode,
    payload?: ClientErrorPayloadByCode[TCode],
  ) {
    super(message, {
      extensions: {
        code,
        ...(payload === undefined ? {} : { payload }),
      },
    });
  }
}

type TransactionEvent = AggregateReplayedEvent<TransactionEvents>;
type TransactionStoredEvent = AggregateStoredEvent<TransactionEvents>;
type BalanceChangingTransactionEvent = Extract<
  TransactionStoredEvent,
  { type: "Deposit" | "Withdrawal" }
>;

type GraphQLContext = {
  requestSignal?: AbortSignal;
};

function isBalanceChangingEvent(
  event: TransactionEvent | TransactionStoredEvent,
): event is BalanceChangingTransactionEvent {
  return (
    !("tombstoned" in event) &&
    (event.type === "Deposit" || event.type === "Withdrawal")
  );
}

async function getExpectedTransactionVersion(
  accountId: string,
): Promise<number> {
  const version = await eventStore.getStreamVersion(
    `${Transaction.streamPrefix}-${accountId}`,
  );
  return version === 0 ? -1 : version;
}

async function loadLatestTransactionEvent(accountId: string) {
  const events = await Transaction.loadEvents(eventStore, accountId);
  return events.at(-1);
}

function toTransactionResult(
  event: TransactionEvent | undefined,
  accountId: string,
) {
  if (!event || !isBalanceChangingEvent(event)) return null;
  return {
    type: event.type,
    bankAccountId: accountId,
    amount: event.data.amount,
    version: event.streamVersion,
  };
}

async function calculateBalance(
  eventStore: EventStore,
  accountId: string,
): Promise<number> {
  const balance = await BankAccountBalance.load(eventStore, accountId);
  return balance.state.balance;
}

function isAlreadyClosedReadableStreamError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    "code" in error &&
    error.code === "ERR_INVALID_STATE" &&
    error.message.includes("ReadableStream is already closed")
  );
}

if (!globalThis.__ignoreClosedReadableStreamConsoleErrors) {
  globalThis.__ignoreClosedReadableStreamConsoleErrors = true;
  const originalConsoleError = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    if (args.some(isAlreadyClosedReadableStreamError)) return;
    originalConsoleError(...args);
  };
}

const yoga = createYoga({
  context: ({ request }: { request: Request }): GraphQLContext => ({
    requestSignal: request.signal,
  }),
  schema: createSchema({
    typeDefs: /* GraphQL */ `
      type Query {
        bankAccount(id: String!): BankAccount
        bankAccountBalance(id: String!): Balance
        transactions(accountId: String!): [Transaction!]!
      }

      type Mutation {
        createBankAccount(accountId: String!, ownerName: String!): BankAccount
        deposit(accountId: String!, amount: Float!): Transaction
        withdraw(accountId: String!, amount: Float!): Transaction
      }

      type Subscription {
        transactionAdded(accountId: String!): Transaction
        balanceChanged(accountId: String!): Balance
      }

      type BankAccount {
        accountId: String!
        status: String!
        ownerName: String!
      }

      type Balance {
        accountId: String!
        balance: Float!
      }

      type Transaction {
        type: String!
        bankAccountId: String!
        amount: Float
        version: Int
      }
    `,
    resolvers: {
      Subscription: {
        transactionAdded: {
          subscribe: async function* (
            _: unknown,
            { accountId }: { accountId: string },
            context: GraphQLContext,
          ) {
            for await (const event of Transaction.subscribe(
              eventStore,
              accountId,
              {
                signal: context.requestSignal,
              },
            )) {
              if (isBalanceChangingEvent(event)) {
                yield {
                  transactionAdded: toTransactionResult(event, accountId),
                };
              }
            }
          },
        },
        balanceChanged: {
          subscribe: async function* (
            _: unknown,
            { accountId }: { accountId: string },
            context: GraphQLContext,
          ) {
            for await (const event of Transaction.subscribe(
              eventStore,
              accountId,
              {
                signal: context.requestSignal,
              },
            )) {
              if (isBalanceChangingEvent(event)) {
                const balance = await calculateBalance(eventStore, accountId);
                yield { balanceChanged: { accountId, balance } };
              }
            }
          },
        },
      },
      Query: {
        bankAccount: async (_: unknown, { id }: { id: string }) => {
          const account = await BankAccount.load(eventStore, id);
          if (account.state === null) return null;
          return { accountId: id, ...account.state };
        },
        bankAccountBalance: async (_: unknown, { id }: { id: string }) => {
          const account = await BankAccount.load(eventStore, id);
          if (account.state === null) return null;
          const balance = await calculateBalance(eventStore, id);
          return { accountId: id, balance };
        },
        transactions: async (
          _: unknown,
          { accountId }: { accountId: string },
        ) => {
          const events = await Transaction.loadEvents(eventStore, accountId);
          return events
            .filter(isBalanceChangingEvent)
            .map((event) => toTransactionResult(event, accountId));
        },
      },
      Mutation: {
        createBankAccount: async (
          _: unknown,
          { accountId, ownerName }: { accountId: string; ownerName: string },
        ) => {
          await BankAccount.append(eventStore, {
            entityId: accountId,
            expectedVersion: -1,
            events: [{ type: "AccountOpened", data: { ownerName } }],
          });
          const account = await BankAccount.load(eventStore, accountId);
          return { accountId, ...account.state };
        },
        deposit: async (
          _: unknown,
          { accountId, amount }: { accountId: string; amount: number },
        ) => {
          const account = await BankAccount.load(eventStore, accountId);
          if (account.state === null) throw new Error("Bank account not found");
          if (amount <= 0) throw new Error("Amount must be positive");

          const expectedVersion =
            await getExpectedTransactionVersion(accountId);

          await Transaction.append(eventStore, {
            entityId: accountId,
            expectedVersion,
            events: [
              { type: "Deposit", data: { bankAccountId: accountId, amount } },
            ],
          });

          return toTransactionResult(
            await loadLatestTransactionEvent(accountId),
            accountId,
          );
        },
        withdraw: async (
          _: unknown,
          { accountId, amount }: { accountId: string; amount: number },
        ) => {
          const account = await BankAccount.load(eventStore, accountId);
          if (account.state === null) throw new Error("Bank account not found");

          const balance = await calculateBalance(eventStore, accountId);
          if (balance < amount) {
            throw new ClientGraphQLError(
              "Insufficient funds",
              "INSUFFICIENT_FUNDS",
              {
                currentBalance: balance,
                requestedAmount: amount,
              },
            );
          }

          const expectedVersion =
            await getExpectedTransactionVersion(accountId);

          await Transaction.append(eventStore, {
            entityId: accountId,
            expectedVersion,
            events: [
              {
                type: "Withdrawal",
                data: { bankAccountId: accountId, amount },
              },
            ],
          });

          return toTransactionResult(
            await loadLatestTransactionEvent(accountId),
            accountId,
          );
        },
      },
    },
  }),
});

const app = new Elysia()
  .post("/graphql", async ({ request }) => {
    const response = await yoga.fetch(request);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  })
  .get("/graphql", async ({ request }) => {
    const response = await yoga.fetch(request);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  });

export default app.compile();
