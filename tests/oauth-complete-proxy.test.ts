import { expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({
  shouldHandleCode: undefined as
    | undefined
    | ((request: { nextUrl: { pathname: string } }) => boolean),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  createRouteMatcher: (paths: string[]) => (request: { nextUrl: { pathname: string } }) =>
    paths.includes(request.nextUrl.pathname),
  nextjsMiddlewareRedirect: vi.fn(),
  convexAuthNextjsMiddleware: (_handler: unknown, options: typeof auth) => {
    auth.shouldHandleCode = options.shouldHandleCode;
    return vi.fn();
  },
}));

test("auth middleware leaves provider callback codes for OAuth completion", async () => {
  await import("../proxy");
  expect(auth.shouldHandleCode).toBeTypeOf("function");
  expect(auth.shouldHandleCode!({ nextUrl: { pathname: "/oauth/complete" } })).toBe(false);
  expect(auth.shouldHandleCode!({ nextUrl: { pathname: "/signin" } })).toBe(true);
});
