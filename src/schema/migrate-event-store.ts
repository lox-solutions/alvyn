import type { Pool } from "pg";

import { DEFAULT_SCHEMA } from "../event-store-constants";
import { withClient } from "../pg-helpers";
import { assertValidSchemaName } from "../sql-helpers";
import { runMigrations } from "./run-migrations";

/** Apply the same migrations used by EventStore.setup() in a deployment job. */
export async function migrateEventStore(options: {
  pool: Pool;
  schema?: string;
}): Promise<void> {
  const schema = options.schema ?? DEFAULT_SCHEMA;
  assertValidSchemaName(schema);
  await withClient(options.pool, (client) => runMigrations(client, schema));
}
