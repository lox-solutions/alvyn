import type { PoolClient } from "pg";

export async function getStreamVersion(options: {
  client: PoolClient;
  schema: string;
  streamId: string;
}): Promise<number> {
  const { client, schema, streamId } = options;
  const result = await client.query<{ max_version: number | null }>(
    `SELECT MAX(stream_version) as max_version FROM ${schema}.events WHERE stream_id = $1`,
    [streamId],
  );
  return result.rows[0]?.max_version ?? 0;
}
