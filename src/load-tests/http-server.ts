import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { OptimisticConcurrencyError } from "../errors";
import type { EventStore } from "../event-store";
import { AccountAggregate, AccountBalanceSnapshot } from "./http-aggregate";

const MAX_BODY_BYTES = 64 * 1024;
const ACCOUNT_PATH = /^\/accounts\/([^/]+)$/;
const DEPOSIT_PATH = /^\/accounts\/([^/]+)\/deposit$/;

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function decodeAccountId(value: string): string | null {
  try {
    const accountId = decodeURIComponent(value);
    return /^[a-z0-9_-]+$/i.test(accountId) ? accountId : null;
  } catch {
    return null;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function getPositiveAmount(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const amount = (body as { amount?: unknown }).amount;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0
    ? amount
    : null;
}

function getOperationToken(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const token = (body as { operationToken?: unknown }).operationToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function wantsSnapshot(url: URL): boolean {
  const value = url.searchParams.get("snapshot");
  return value === "1" || value === "true";
}

async function handleRequest({
  request,
  response,
  eventStore,
  workerId,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  eventStore: EventStore;
  workerId: number;
}): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ready", workerId });
    return;
  }

  const accountMatch = ACCOUNT_PATH.exec(url.pathname);
  const depositMatch = DEPOSIT_PATH.exec(url.pathname);
  const accountId = decodeAccountId(
    accountMatch?.[1] ?? depositMatch?.[1] ?? "",
  );
  if (!accountId) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (request.method === "GET" && accountMatch) {
    if (wantsSnapshot(url)) {
      const snapshot = await AccountBalanceSnapshot.load(eventStore, accountId);
      if (snapshot.version === 0) {
        sendJson(response, 404, { error: "account_not_found" });
        return;
      }
      sendJson(response, 200, snapshot);
    } else {
      const aggregate = await AccountAggregate.load(eventStore, accountId);
      if (aggregate.state === null) {
        sendJson(response, 404, { error: "account_not_found" });
        return;
      }
      sendJson(response, 200, aggregate);
    }
    return;
  }

  if (request.method === "POST" && depositMatch) {
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      sendJson(response, 400, {
        error: "invalid_json",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const amount = getPositiveAmount(body);
    const operationToken = getOperationToken(body);
    if (amount === null || operationToken === null) {
      sendJson(response, 400, {
        error: "invalid_deposit",
        message: "amount and operationToken are required",
      });
      return;
    }
    const aggregate = await AccountAggregate.load(eventStore, accountId);
    if (aggregate.state === null) {
      sendJson(response, 404, { error: "account_not_found" });
      return;
    }
    try {
      const result = await AccountAggregate.append(eventStore, {
        entityId: accountId,
        expectedVersion: aggregate.version,
        events: [
          {
            type: "MoneyDeposited",
            data: { amount, operationToken },
          },
        ],
      });
      sendJson(response, 201, {
        ...result,
        accountId,
        amount,
        operationToken,
      });
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        sendJson(response, 409, {
          error: "optimistic_concurrency",
          expectedVersion: error.expectedVersion,
          actualVersion: error.actualVersion,
        });
        return;
      }
      throw error;
    }
    return;
  }

  sendJson(response, 405, { error: "method_not_allowed" });
}

export function createAggregateHttpServer({
  eventStore,
  workerId,
}: {
  eventStore: EventStore;
  workerId: number;
}): Server {
  return createServer((request, response) => {
    void handleRequest({ request, response, eventStore, workerId }).catch(
      (error: unknown) => {
        if (!response.headersSent) {
          sendJson(response, 500, {
            error: "internal_error",
            message: error instanceof Error ? error.message : String(error),
          });
        } else {
          response.destroy();
        }
      },
    );
  });
}
