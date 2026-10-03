import { expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({
  handler: undefined as
    | undefined
    | ((
        request: { nextUrl: { pathname: string; search: string } },
        ctx: { convexAuth: { isAuthenticated: () => Promise<boolean> } },
      ) => Promise<unknown>),
  shouldHandleCode: undefined as
    undefined | ((request: { nextUrl: { pathname: string } }) => boolean),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  createRouteMatcher:
    (paths: string[]) => (request: { nextUrl: { pathname: string } }) =>
      paths.includes(request.nextUrl.pathname),
  nextjsMiddlewareRedirect: vi.fn(),
  convexAuthNextjsMiddleware: (
    handler: NonNullable<typeof auth.handler>,
    options: Pick<typeof auth, "shouldHandleCode">,
  ) => {
    auth.handler = handler;
    auth.shouldHandleCode = options.shouldHandleCode;
    return vi.fn();
  },
}));

test("auth middleware leaves provider callback codes for OAuth completion", async () => {
  await import("../proxy");
  expect(auth.shouldHandleCode).toBeTypeOf("function");
  expect(
    auth.shouldHandleCode!({ nextUrl: { pathname: "/oauth/complete" } }),
  ).toBe(false);
  expect(auth.shouldHandleCode!({ nextUrl: { pathname: "/signin" } })).toBe(
    true,
  );
});

test("only the bridge bypasses browser sign-in for its own server authentication", async () => {
  const { nextjsMiddlewareRedirect } =
    await import("@convex-dev/auth/nextjs/server");
  await import("../proxy");
  const isAuthenticated = vi.fn().mockResolvedValue(false);
  const ctx = { convexAuth: { isAuthenticated } };
  await auth.handler!(
    { nextUrl: { pathname: "/api/connect/bridge", search: "" } },
    ctx,
  );
  expect(isAuthenticated).not.toHaveBeenCalled();
  expect(nextjsMiddlewareRedirect).not.toHaveBeenCalled();
  await auth.handler!(
    { nextUrl: { pathname: "/connections", search: "" } },
    ctx,
  );
  expect(isAuthenticated).toHaveBeenCalledOnce();
  expect(nextjsMiddlewareRedirect).toHaveBeenCalledWith(
    expect.anything(),
    "/signin?redirectTo=%2Fconnections",
  );
});
