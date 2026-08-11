/* eslint-disable llm-core/no-inline-disable */
/* eslint-disable llm-core/filename-match-export */
import { InvalidSchemaNameError } from "./errors";

const SAFE_SCHEMA_NAME_REGEX = /^[a-z_][a-z0-9_]{0,62}$/;

/** Ensures a schema name is safe to interpolate into an SQL identifier. */
export function assertValidSchemaName(schema: string): void {
  if (!SAFE_SCHEMA_NAME_REGEX.test(schema)) {
    throw new InvalidSchemaNameError(schema);
  }
}
