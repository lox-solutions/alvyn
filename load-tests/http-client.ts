import type { HttpOperationPlan } from "./http-types";
import { validateHttpOperationResponse } from "./validate-http-operation-response";
import { withTimeout } from "./timeout";

const HTTP_OK_STATUS = 200;
const HTTP_CREATED_STATUS = 201;

export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function sendHttpOperation({
  port,
  operation,
  timeoutMs,
}: {
  port: number;
  operation: HttpOperationPlan;
  timeoutMs: number;
}): Promise<Response> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const request =
    operation.kind === "read"
      ? fetch(
          `${baseUrl}/accounts/${encodeURIComponent(operation.accountId)}`,
          { signal: controller.signal },
        )
      : fetch(
          `${baseUrl}/accounts/${encodeURIComponent(operation.accountId)}/deposit`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              amount: operation.amount,
              operationToken: operation.operationToken,
            }),
            signal: controller.signal,
          },
        );
  return withTimeout({
    operation: request,
    timeoutMs,
    label: `${operation.kind} HTTP request for ${operation.accountId}`,
    onTimeout: () => controller.abort(),
  });
}

export function validateSuccessfulResponse({
  operation,
  response,
  body,
}: {
  operation: HttpOperationPlan;
  response: Response;
  body: unknown;
}): void {
  const expectedStatus =
    operation.kind === "read" ? HTTP_OK_STATUS : HTTP_CREATED_STATUS;
  if (response.status !== expectedStatus) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  validateHttpOperationResponse(operation, body);
}

export async function sendHttpAccountRead({
  port,
  accountId,
  snapshots,
  timeoutMs,
}: {
  port: number;
  accountId: string;
  snapshots: boolean;
  timeoutMs: number;
}): Promise<Response> {
  const suffix = snapshots ? "?snapshot=true" : "";
  const controller = new AbortController();
  return withTimeout({
    operation: fetch(
      `http://127.0.0.1:${port}/accounts/${encodeURIComponent(accountId)}${suffix}`,
      { signal: controller.signal },
    ),
    timeoutMs,
    label: `snapshot benchmark read for ${accountId}`,
    onTimeout: () => controller.abort(),
  });
}

export function getReplayedEvents(body: unknown): number {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !Number.isInteger((body as Record<string, unknown>).replayedEvents)
  ) {
    throw new Error("Snapshot response did not include replayedEvents");
  }
  const replayedEvents = (body as { replayedEvents: number }).replayedEvents;
  if (replayedEvents < 0) {
    throw new Error("Snapshot response included a negative replay count");
  }
  return replayedEvents;
}
