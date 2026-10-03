import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const isAuthApiRoute = createRouteMatcher(["/api/auth(.*)"]);

const isConnectBridge = createRouteMatcher(["/api/connect/bridge"]);
const isPublicPage = createRouteMatcher(["/", "/privacy", "/terms"]);

const isRequestLink = createRouteMatcher([
  "/connect/(.*)",
  "/requests/new/(.*)",
  "/requests/token/(.*)",
]);

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    if (isAuthApiRoute(request) || isConnectBridge(request)) {
      return;
    }
    if (isPublicPage(request)) {
      return;
    }
    const isAuthenticated = await convexAuth.isAuthenticated();
    if (isSignInPage(request)) {
      if (isAuthenticated) {
        const redirectTo = safeRedirectPath(
          request.nextUrl.searchParams.get("redirectTo"),
        );
        return nextjsMiddlewareRedirect(request, redirectTo);
      }
      return;
    }
    if (isRequestLink(request)) {
      return;
    }
    if (!isAuthenticated) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      const redirectTo = encodeURIComponent(safeRedirectPath(next));
      return nextjsMiddlewareRedirect(
        request,
        `/signin?redirectTo=${redirectTo}`,
      );
    }
  },
  {
    shouldHandleCode: (request) =>
      request.nextUrl.pathname !== "/oauth/complete",
  },
);

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
