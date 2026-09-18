import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const isAuthApiRoute = createRouteMatcher(["/api/auth(.*)"]);
/** Request links show the email verification form at the request URL. */
const isRequestLink = createRouteMatcher([
  "/requests/new/(.*)",
  "/requests/token/(.*)",
]);

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
});

export const config = {
  // The following matcher runs proxy on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
