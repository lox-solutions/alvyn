import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import pg from "pg";
import { randomBytes } from "node:crypto";

const { Pool } = pg;

let container: StartedPostgreSqlContainer | null = null;
let connectionUri: string | null = null;

/**
 * Starts a shared PostgreSQL container (reused across test files in the same process).
 * Call this in beforeAll().
 */
export async function startPostgres(): Promise<void> {
  if (container) return;
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  connectionUri = container.getConnectionUri();
}

/**
 * Stops the shared PostgreSQL container.
 * Call this in afterAll() of the last suite, or let process exit handle it.
 */
export async function stopPostgres(): Promise<void> {
  if (container) {
    await container.stop();
    container = null;
    connectionUri = null;
  }
}

/**
 * Creates a new Pool connected to the test container.
 */
export function createTestPool(): pg.Pool {
  if (!connectionUri) {
    throw new Error(
      "PostgreSQL container not started. Call startPostgres() first.",
    );
  }
  return new Pool({ connectionString: connectionUri });
}

/**
 * Generates a unique schema name for test isolation.
 */
export function uniqueSchema(): string {
  return `test_${randomBytes(6).toString("hex")}`;
}

/**
 * Generates a valid 256-bit master encryption key (64 hex chars).
 */
export function testMasterKey(): string {
  return randomBytes(32).toString("hex");
}
