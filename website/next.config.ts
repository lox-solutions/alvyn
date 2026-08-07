import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const withMDX = createMDX();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: "/alvyn",
  outputFileTracingRoot: workspaceRoot,
};

export default withMDX(nextConfig);
