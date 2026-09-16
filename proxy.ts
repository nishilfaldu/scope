import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const isAuthApiRoute = createRouteMatcher(["/api/auth(.*)"]);
/** Deep links must render a Link-style gate before auth — do not bounce away. */
const isApprovalDeepLink = createRouteMatcher(["/approvals/:token"]);

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // Let the auth endpoints through so sign-in and sign-out work.
  if (isAuthApiRoute(request)) {
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
  if (isApprovalDeepLink(request)) {
    // Signed-out users see the Link-style gate on the page itself.
    return;
  }
  if (!isAuthenticated) {
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const redirectTo = encodeURIComponent(safeRedirectPath(next));
    return nextjsMiddlewareRedirect(request, `/signin?redirectTo=${redirectTo}`);
  }
});

export const config = {
  // The following matcher runs proxy on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
