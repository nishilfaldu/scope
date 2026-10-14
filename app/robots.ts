import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in pages and endpoints have nothing to index.
      disallow: [
        "/requests",
        "/apps",
        "/activity",
        "/accounts",
        "/notifications",
        "/api/",
        "/mcp",
        "/signin",
        "/callback",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
