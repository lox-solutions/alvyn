import { getLLMText, getPageMarkdownUrl, source } from "@/lib/source";
import { notFound } from "next/navigation";

export const revalidate = false;

export async function GET(
  _req: Request,
  props: { params: Promise<{ slug: string[] }> },
) {
  const params = await props.params;
  const slug = params.slug;

  const pageSlug =
    slug.length > 0 && slug[slug.length - 1] === "content.md"
      ? slug.slice(0, -1)
      : slug;

  const page = source.getPage(pageSlug.length > 0 ? pageSlug : undefined);
  if (!page) notFound();

  const content = await getLLMText(page);

  return new Response(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: getPageMarkdownUrl(page).segments,
  }));
}
