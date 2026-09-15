import type { MetadataRoute } from "next";

// Public marketing pages are indexable; the product, operator and API
// surfaces aren't.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api", "/auth", "/u/"] },
  };
}
