import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/",
      "/privacy",
      "/terms",
      "/signin",
      "/callback",
      "/mcp",
      // Generated metadata images have no file extension.
      "/opengraph-image",
      "/apple-icon",
    ],
  },
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
