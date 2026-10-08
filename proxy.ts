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
      "/api/agent/:path*",
      "/mcp",
    ],
  },
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
