import { defineConfig, type Plugin } from "vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import { startDevDatabase, stopDevDatabase } from "./server/dev-database";

function devDatabasePlugin(
  container: NonNullable<Awaited<ReturnType<typeof startDevDatabase>>>,
): Plugin {
  let stopPromise: Promise<void> | undefined;
  let signalHandled = false;

  const stop = () => {
    stopPromise ??= stopDevDatabase(container);
    return stopPromise;
  };

  const handleSignal = (exitCode: number) => {
    if (signalHandled) return;
    signalHandled = true;

    void stop()
      .catch((error: unknown) => {
        console.error("Failed to stop the development database:", error);
      })
      .finally(() => {
        process.exit(exitCode);
      });
  };

  process.once("SIGINT", () => handleSignal(130));
  process.once("SIGTERM", () => handleSignal(143));

  return {
    name: "example-dev-database",
    configureServer(server) {
      server.httpServer?.once("close", () => {
        void stop();
      });
    },
    async closeBundle() {
      await stop();
    },
  };
}

export default defineConfig(async ({ command }) => {
  const isVitest = Boolean(process.env.VITEST || process.env.VITEST_WORKER_ID);
  const devContainer =
    command === "serve" && !isVitest ? await startDevDatabase() : undefined;

  return {
    plugins: [
      ...(devContainer ? [devDatabasePlugin(devContainer)] : []),
      nitro(),
      react(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
  };
});
