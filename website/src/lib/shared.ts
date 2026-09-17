import { createGetUrl } from "fumadocs-core/source";

export const appName = "Alvyn";
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";
export const baseUrl = "https://alvyn.dev";

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "content.md"];

  return { segments, url: getContentUrl(segments, page.locale) };
}

export const gitConfig = {
  user: "lox-solutions",
  repo: "alvyn",
  branch: "main",
};
