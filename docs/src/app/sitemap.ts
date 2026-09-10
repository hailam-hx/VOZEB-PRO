import type { MetadataRoute } from "next";

import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"
  ).replace(/\/+$/, "");
  return [
    {
      url: `${baseUrl}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...source.getPages().map((page) => ({
      url: `${baseUrl}${page.url}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
