import type { ServerResponse } from "node:http";
import type { EventStore } from "../event-store";
import { AccountAggregate, AccountBalanceSnapshot } from "./http-aggregate";
import { sendJson } from "./http-server-helpers";

const HTTP_OK_STATUS = 200;
const HTTP_NOT_FOUND_STATUS = 404;

export async function handleGetAccount({
  response,
  eventStore,
  accountId,
  snapshot,
}: {
  response: ServerResponse;
  eventStore: EventStore;
  accountId: string;
  snapshot: boolean;
}): Promise<void> {
  if (snapshot) {
    const aggregate = await AccountBalanceSnapshot.load(eventStore, accountId);
    if (aggregate.version === 0) {
      sendJson({
        response,
        statusCode: HTTP_NOT_FOUND_STATUS,
        body: { error: "account_not_found" },
      });
      return;
    }
    sendJson({ response, statusCode: HTTP_OK_STATUS, body: aggregate });
    return;
  }
  const aggregate = await AccountAggregate.load(eventStore, accountId);
  if (aggregate.state === null) {
    sendJson({
      response,
      statusCode: HTTP_NOT_FOUND_STATUS,
      body: { error: "account_not_found" },
    });
    return;
  }
  sendJson({ response, statusCode: HTTP_OK_STATUS, body: aggregate });
}
