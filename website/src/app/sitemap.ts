import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { baseUrl } from "@/lib/shared";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: baseUrl },
    ...source.getPages().map((page) => ({ url: `${baseUrl}${page.url}` })),
  ];
}
