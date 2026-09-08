import { getLLMText, source } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();
  const contents = await Promise.all(pages.map((page) => getLLMText(page)));

  return new Response(contents.join("\n\n---\n\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
