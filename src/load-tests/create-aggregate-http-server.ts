import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { EventStore } from "../event-store";
import { handleDeposit } from "./handle-deposit";
import { handleGetAccount } from "./handle-get-account";
import {
  decodeAccountId,
  sendJson,
  wantsSnapshot,
} from "./http-server-helpers";

const ACCOUNT_PATH = /^\/accounts\/([^/]+)$/;
const DEPOSIT_PATH = /^\/accounts\/([^/]+)\/deposit$/;
const HTTP_OK_STATUS = 200;
const HTTP_NOT_FOUND_STATUS = 404;
const HTTP_METHOD_NOT_ALLOWED_STATUS = 405;
const HTTP_INTERNAL_SERVER_ERROR_STATUS = 500;

async function routeRequest({
  request,
  response,
  eventStore,
  url,
  accountMatch,
  depositMatch,
  accountId,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  eventStore: EventStore;
  url: URL;
  accountMatch: RegExpExecArray | null;
  depositMatch: RegExpExecArray | null;
  accountId: string;
}): Promise<void> {
  if (request.method === "GET" && accountMatch) {
    await handleGetAccount({
      response,
      eventStore,
      accountId,
      snapshot: wantsSnapshot(url),
    });
    return;
  }
  if (request.method === "POST" && depositMatch) {
    await handleDeposit({ request, response, eventStore, accountId });
    return;
  }
  sendJson({
    response,
    statusCode: HTTP_METHOD_NOT_ALLOWED_STATUS,
    body: { error: "method_not_allowed" },
  });
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
    sendJson({
      response,
      statusCode: HTTP_OK_STATUS,
      body: { status: "ready", workerId },
    });
    return;
  }

  const accountMatch = ACCOUNT_PATH.exec(url.pathname);
  const depositMatch = DEPOSIT_PATH.exec(url.pathname);
  const accountId = decodeAccountId(
    accountMatch?.[1] ?? depositMatch?.[1] ?? "",
  );
  if (!accountId) {
    sendJson({
      response,
      statusCode: HTTP_NOT_FOUND_STATUS,
      body: { error: "not_found" },
    });
    return;
  }

  await routeRequest({
    request,
    response,
    eventStore,
    url,
    accountMatch,
    depositMatch,
    accountId,
  });
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
          sendJson({
            response,
            statusCode: HTTP_INTERNAL_SERVER_ERROR_STATUS,
            body: {
              error: "internal_error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        } else {
          response.destroy();
        }
      },
    );
  });
}
