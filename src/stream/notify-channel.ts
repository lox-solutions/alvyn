/**
 * Returns the PostgreSQL `LISTEN/NOTIFY` channel used to signal newly appended
 * events for a given event-store schema.
 *
 * The channel is per-schema so multiple event stores in the same database do
 * not wake each other's subscribers. The schema name is already validated
 * (see {@link SCHEMA_NAME_REGEX}), so it is safe to embed in the channel name.
 */
export function notifyChannel(schema: string): string {
  return `alvyn_events_${schema}`;
}
