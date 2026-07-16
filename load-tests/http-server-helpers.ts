import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 64 * 1024;

export function sendJson({
  response,
  statusCode,
  body,
}: {
  response: ServerResponse;
  statusCode: number;
  body: unknown;
}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: string[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value: unknown = chunk;
    const text = toRequestText(value);
    size += Buffer.byteLength(text);
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(text);
  }
  if (size === 0) return {};
  return JSON.parse(chunks.join("")) as unknown;
}

function toRequestText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

export function decodeAccountId(value: string): string | null {
  try {
    const accountId = decodeURIComponent(value);
    return /^[a-z0-9_-]+$/i.test(accountId) ? accountId : null;
  } catch {
    return null;
  }
}

export function getPositiveAmount(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const amount = (body as { amount?: unknown }).amount;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0
    ? amount
    : null;
}

export function getOperationToken(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const token = (body as { operationToken?: unknown }).operationToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function wantsSnapshot(url: URL): boolean {
  const value = url.searchParams.get("snapshot");
  return value === "1" || value === "true";
}
