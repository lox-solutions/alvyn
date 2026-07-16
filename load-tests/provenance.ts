import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";

export interface LoadTestEnvironment {
  generatedAt: string;
  revision: string | null;
  alvynVersion: string;
  nodeVersion: string;
  postgresqlVersion: string | null;
  platform: NodeJS.Platform;
  architecture: string;
  osRelease: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
}

function readAlvynVersion(): string {
  for (const relativePath of ["../package.json"]) {
    try {
      const packageJson = JSON.parse(
        readFileSync(new URL(relativePath, import.meta.url), "utf8"),
      ) as { version?: unknown };
      if (typeof packageJson.version === "string") return packageJson.version;
    } catch {
      continue;
    }
  }
  return process.env.npm_package_version ?? "unknown";
}

function readRevision(): string | null {
  const ciRevision = process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA;
  if (ciRevision) return ciRevision;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function createLoadTestEnvironment(
  postgresqlVersion: string | null,
): LoadTestEnvironment {
  const processors = cpus();
  return {
    generatedAt: new Date().toISOString(),
    revision: readRevision(),
    alvynVersion: readAlvynVersion(),
    nodeVersion: process.version,
    postgresqlVersion,
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
    cpuModel: processors[0]?.model ?? "unknown",
    cpuCount: processors.length,
    totalMemoryBytes: totalmem(),
  };
}
