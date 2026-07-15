import type { IncomingMessage, ServerResponse } from "node:http";
import { OptimisticConcurrencyError } from "../errors";
import type { EventStore } from "../event-store";
import { AccountAggregate } from "./http-aggregate";
import {
  getOperationToken,
  getPositiveAmount,
  readJson,
  sendJson,
} from "./http-server-helpers";

const HTTP_CREATED_STATUS = 201;
const HTTP_BAD_REQUEST_STATUS = 400;
const HTTP_NOT_FOUND_STATUS = 404;
const HTTP_CONFLICT_STATUS = 409;

async function readDepositBody({
  request,
  response,
}: {
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<{ amount: number; operationToken: string } | null> {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    sendJson({
      response,
      statusCode: HTTP_BAD_REQUEST_STATUS,
      body: {
        error: "invalid_json",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
  const amount = getPositiveAmount(body);
  const operationToken = getOperationToken(body);
  if (amount === null || operationToken === null) {
    sendJson({
      response,
      statusCode: HTTP_BAD_REQUEST_STATUS,
      body: {
        error: "invalid_deposit",
        message: "amount and operationToken are required",
      },
    });
    return null;
  }
  return { amount, operationToken };
}

async function appendDeposit({
  response,
  eventStore,
  accountId,
  amount,
  operationToken,
  expectedVersion,
}: {
  response: ServerResponse;
  eventStore: EventStore;
  accountId: string;
  amount: number;
  operationToken: string;
  expectedVersion: number;
}): Promise<void> {
  try {
    const result = await AccountAggregate.append(eventStore, {
      entityId: accountId,
      expectedVersion,
      events: [{ type: "MoneyDeposited", data: { amount, operationToken } }],
    });
    sendJson({
      response,
      statusCode: HTTP_CREATED_STATUS,
      body: { ...result, accountId, amount, operationToken },
    });
  } catch (error) {
    if (!(error instanceof OptimisticConcurrencyError)) throw error;
    sendJson({
      response,
      statusCode: HTTP_CONFLICT_STATUS,
      body: {
        error: "optimistic_concurrency",
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      },
    });
  }
}

export async function handleDeposit({
  request,
  response,
  eventStore,
  accountId,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  eventStore: EventStore;
  accountId: string;
}): Promise<void> {
  const deposit = await readDepositBody({ request, response });
  if (deposit === null) return;
  const aggregate = await AccountAggregate.load(eventStore, accountId);
  if (aggregate.state === null) {
    sendJson({
      response,
      statusCode: HTTP_NOT_FOUND_STATUS,
      body: { error: "account_not_found" },
    });
    return;
  }
  await appendDeposit({
    response,
    eventStore,
    accountId,
    amount: deposit.amount,
    operationToken: deposit.operationToken,
    expectedVersion: aggregate.version,
  });
}
