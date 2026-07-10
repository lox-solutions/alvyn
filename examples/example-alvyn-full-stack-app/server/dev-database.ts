import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

export const devContainerName = "alvyn-example-postgres-dev";

export async function startDevDatabase(): Promise<
  StartedPostgreSqlContainer | undefined
> {
  if (process.env.DATABASE_URL) return undefined;

  process.env.TESTCONTAINERS_REUSE_ENABLE = "true";

  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withName(devContainerName)
    .withLabels({
      "com.lox-solutions.alvyn.example": "dev-postgres",
    })
    .withReuse()
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();

  console.log(
    `♻️ Using reusable Postgres dev container "${devContainerName}" at ${process.env.DATABASE_URL}`,
  );

  return container;
}

export async function stopDevDatabase(
  container: StartedPostgreSqlContainer,
): Promise<void> {
  await container.stop({ remove: false });
}
