import type { Pool, PoolClient } from "pg";
import { OptimisticConcurrencyError } from "./errors";

/** Executes a function with a pooled client, releasing it afterward. */
export async function withClient<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Executes a function within a PostgreSQL transaction. */
export async function inTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Retries a function that may fail with OptimisticConcurrencyError. */
export async function retryOnConcurrencyError<T>(
  fn: () => Promise<T>,
  maxRetries: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError && attempt < maxRetries) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
