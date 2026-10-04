import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scope",
    short_name: "Scope",
    // Preserve the identity of existing Home Screen installations.
    id: "/lab",
    start_url: "/access",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#f7f9f5",
    icons: [
      {
        src: "/brand/scope-mark-512.png?v=dark-green",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
