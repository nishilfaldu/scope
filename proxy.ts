import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const isAuthApiRoute = createRouteMatcher(["/api/auth(.*)"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // Let the auth endpoints through so sign-in and sign-out work.
  if (isAuthApiRoute(request)) {
    return;
  }
  const isAuthenticated = await convexAuth.isAuthenticated();
  if (isSignInPage(request)) {
    if (isAuthenticated) {
      return nextjsMiddlewareRedirect(request, "/");
    }
    return;
  }
  if (!isAuthenticated) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

export const config = {
  // The following matcher runs proxy on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
