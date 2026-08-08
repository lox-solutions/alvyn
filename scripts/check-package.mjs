// Ensure the npm package excludes development-only test and load-test files.
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const cache = join(tmpdir(), "alvyn-npm-cache");
const output = execFileSync(command, ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  env: {
    ...process.env,
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
  },
});
const packages = JSON.parse(output);
const prohibited = packages[0].files
  .map((file) => file.path)
  .filter(
    (path) =>
      path.includes(".test.") ||
      path.startsWith("dist/__tests__/") ||
      path.startsWith("dist/load-tests/"),
  );

if (prohibited.length > 0) {
  throw new Error(
    `Package contains development-only files:\n${prohibited.join("\n")}`,
  );
}
