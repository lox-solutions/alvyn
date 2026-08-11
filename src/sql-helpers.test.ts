import { describe, expect, it } from "vitest";
import { InvalidSchemaNameError } from "./errors";
import { assertValidSchemaName } from "./sql-helpers";

describe("assertValidSchemaName", () => {
  it.each(["event_store", "a", "_private", `a${"b".repeat(61)}`])(
    "accepts %s",
    (schema) => {
      expect(() => assertValidSchemaName(schema)).not.toThrow();
    },
  );

  it.each([
    "",
    "1schema",
    "UPPER_CASE",
    `a${"b".repeat(63)}`,
    "schema-name",
    "schema; DROP TABLE events",
    "schema' OR '1'='1",
  ])("rejects unsafe schema %s", (schema) => {
    expect(() => assertValidSchemaName(schema)).toThrow(InvalidSchemaNameError);
  });
});
