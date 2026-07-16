const HTTP_RETRY_BASE_DELAY_MS = 5;
const HTTP_RETRY_MAX_DELAY_MS = 50;
const HTTP_RETRY_JITTER_RANGE_MS = 10;
const HTTP_RETRY_OPERATION_JITTER = 17;
const HTTP_RETRY_ATTEMPT_JITTER = 13;

function getHttpRetryDelayMs(
  operationIndex: number,
  retryNumber: number,
): number {
  const exponentialDelay = Math.min(
    HTTP_RETRY_MAX_DELAY_MS,
    HTTP_RETRY_BASE_DELAY_MS * 2 ** retryNumber,
  );
  const jitter =
    (operationIndex * HTTP_RETRY_OPERATION_JITTER +
      retryNumber * HTTP_RETRY_ATTEMPT_JITTER) %
    HTTP_RETRY_JITTER_RANGE_MS;
  return exponentialDelay + jitter;
}

export function getHttpWorkerIndex({
  operationIndex,
  attempt,
  workerCount,
}: {
  operationIndex: number;
  attempt: number;
  workerCount: number;
}): number {
  return (operationIndex + attempt) % workerCount;
}

export async function retryHttpRequest<T>({
  operationIndex,
  maxRetries,
  send,
  isConflict,
  wait = (delayMs) =>
    new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, delayMs);
    }),
}: {
  operationIndex: number;
  maxRetries: number;
  send: (attempt: number) => Promise<T>;
  isConflict: (value: T) => boolean;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<{ value: T; conflicts: number; retries: number }> {
  let conflicts = 0;
  let retries = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const value = await send(attempt);
    if (!isConflict(value)) return { value, conflicts, retries };
    conflicts++;
    if (attempt >= maxRetries) return { value, conflicts, retries };
    retries++;
    await wait(getHttpRetryDelayMs(operationIndex, retries - 1));
  }
  throw new Error("HTTP retry loop did not terminate");
}
