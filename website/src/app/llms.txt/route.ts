import { appName, baseUrl } from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();
  const lines: string[] = [
    `# ${appName}`,
    "",
    "> Event sourcing library for Node.js and PostgreSQL",
    "",
    "## Documentation",
    "",
  ];

  for (const page of pages) {
    const mdUrl = `${baseUrl}${getPageMarkdownUrl(page).url}`;
    const description = page.data.description
      ? `: ${page.data.description}`
      : "";
    lines.push(`- [${page.data.title}](${mdUrl})${description}`);
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
